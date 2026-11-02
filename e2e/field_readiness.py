"""Field-readiness browser tests. Usage: python3 smoke2.py BASE_URL OUTDIR"""
import re, sys, json
from playwright.sync_api import sync_playwright

BASE = sys.argv[1].rstrip('/') + '/'
OUT = sys.argv[2]
results, errors = [], []

def step(name, fn):
    try:
        d = fn(); results.append({'step': name, 'ok': True, 'detail': d or ''}); print('PASS', name, '::', (d or '')[:160])
    except Exception as e:
        results.append({'step': name, 'ok': False, 'detail': str(e)[:500]}); print('FAIL', name, '::', str(e)[:500])

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=['--no-sandbox'])
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900}, accept_downloads=True)
    page = ctx.new_page()
    page.on('console', lambda m: m.type == 'error' and errors.append(m.text))
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('dialog', lambda d: d.accept())  # confirm() prompts in reset/start/restore/retire

    def nav(h): page.goto(BASE + '#/' + h); page.wait_for_timeout(250)
    def act_as(pid): page.select_option('select[aria-label="Acting as"]', pid)
    def banner():
        b = page.locator('.banner.ok, .banner.bad').last; b.wait_for(timeout=5000); return b.inner_text().replace('\n', ' ')
    def field(label):
        return page.locator('label.field', has=page.locator('.field-label', has_text=re.compile('^' + re.escape(label)))).locator('select, input').first
    def events():
        return int(re.search(r'(\d+) ledger events', page.locator('.foot').inner_text()).group(1))

    def fresh():
        page.goto(BASE); page.wait_for_selector('.tiles', timeout=15000)
        nav('about'); page.click('button:has-text("Erase and load demo data")'); page.wait_for_selector('.tiles', timeout=10000)
        return f'{events()} events (fresh demo)'
    step('Start from fresh demo data', fresh)

    def offline_ready():
        page.wait_for_function("document.querySelector('.foot') && document.querySelector('.foot').innerText.includes('works offline')", timeout=30000)
        n = page.evaluate("caches.keys().then(async ks => { let n=0; for (const k of ks) n += (await (await caches.open(k)).keys()).length; return [ks, n]; })")
        return f'service worker active; caches {n[0]} hold {n[1]} files'
    step('Service worker installs and pre-caches the app', offline_ready)

    def offline_reload():
        before = events()
        ctx.set_offline(True)
        page.reload(); page.wait_for_selector('.tiles', timeout=15000); page.wait_for_timeout(400)
        assert page.locator('text=No connection').count() == 1, 'offline banner missing'
        after = events()
        assert before == after, (before, after)
        page.screenshot(path=f'{OUT}/10-offline.png')
        return f'reloaded with network off: app opened, offline banner shown, {after} events intact'
    step('App opens with no network (offline reload)', offline_reload)

    def offline_transact():
        act_as('p-kalani')
        nav('act/quarantine?from=HI-PHARM&lot=lot-epi-hi-old&qty=8&reason=Expired')
        page.click('button:has-text("Quarantine")'.replace('button:', 'form button:'))
        t = banner(); assert t.startswith('Recorded'), t
        return 'offline: ' + t[:120]
    step('Quarantine expired lot while offline', offline_transact)

    def dispose_no_witness():
        nav('act/dispose?lot=lot-epi-hi-old&from=HI-PHARM')
        field('Method').fill('Pharmaceutical waste bin')
        page.click('button:has-text("Record disposal")')
        t = banner(); assert 'witness' in t.lower(), t
        return t[:120]
    step('Disposal without witness is refused', dispose_no_witness)

    def dispose_ok():
        nav('act/dispose?lot=lot-epi-hi-old&from=HI-PHARM')
        field('Method').fill('Pharmaceutical waste bin')
        field('Witness').select_option('p-reyes')
        page.click('button:has-text("Record disposal")')
        t = banner(); assert t.startswith('Recorded') and 'Disposed 8' in t, t
        return t[:140]
    step('Witnessed disposal of quarantined stock (offline)', dispose_ok)

    def missing():
        nav('act/missing?from=HI-WH')
        field('Lot').select_option('lot-iv-hi')
        field('Quantity').fill('2')
        page.click('form button:has-text("Report missing")')
        t = banner(); assert t.startswith('Recorded') and 'missing' in t, t
        return t[:140]
    step('Report 2 units missing after a count', missing)

    def offline_scan():
        nav('labels')
        page.select_option('select[aria-label="Barcode type"]', 'datamatrix')
        dm = page.locator('.sheet.test .label', has_text='lot never received').first
        dm.locator('.qr.dm svg').wait_for(timeout=15000)
        dm.screenshot(path=f'{OUT}/dm-label.png')
        page.screenshot(path=f'{OUT}/11-labels-dm.png', full_page=True)
        nav('scan'); page.click('button.tab:has-text("Camera")')
        page.set_input_files('.file-btn input', f'{OUT}/dm-label.png')
        page.wait_for_selector('.result', timeout=20000)
        h = page.locator('.result h2').inner_text(); src = page.locator('.result .sub').first.inner_text()
        assert 'new lot TEST7731' in h, (h, src)
        return f'offline: generated GS1 DataMatrix, decoded it → "{h}" ({src[:70]})'
    step('Offline: generate GS1 DataMatrix, decode it with camera reader', offline_scan)

    def back_online():
        ctx.set_offline(False); page.wait_for_timeout(300)
        return 'network restored'
    step('Back online', back_online)

    def backup():
        nav('about')
        with page.expect_download() as d:
            page.click('button:has-text("Export backup")')
        path = f'{OUT}/backup.json'; d.value.save_as(path)
        data = json.load(open(path))
        assert data['format'] == 'fieldline-ledger-export' and len(data['events']) == events()
        return f"{len(data['events'])} events, {len(data['reference']['items'])} items exported"
    step('Export backup', backup)

    def blank():
        nav('about')
        page.fill('input[placeholder="e.g. Logistics lead"]', 'Field test lead')
        page.click('button:has-text("Erase this device and start")')
        page.wait_for_url(re.compile(r'#/setup\?tab=locations'), timeout=10000)
        page.wait_for_timeout(300)
        strip = page.locator('.demo-strip').inner_text()
        assert 'FIELD TEST' in strip, strip
        assert events() == 0
        return f'empty dataset, 0 events; strip: {strip[:60]}'
    step('Start my own field test (blank, two hubs)', blank)

    def setup_location():
        page.click('button:has-text("Add location")')
        field('Name').fill('Pharmacy cage A')
        field('Kind').select_option('STORAGE')
        field('Inside').select_option(label='Hawaii Hub')
        page.click('button:has-text("Add location"):not(.small)')
        t = banner(); assert t.startswith('Saved'), t
        page.click('button:has-text("Add location")')
        field('Name').fill('Team Alpha site')
        field('Kind').select_option('DEPLOYMENT_SITE')
        field('Inside').select_option(label='Germany Hub')
        page.wait_for_timeout(300)
        field('Country (for the map)').fill('Poland')
        page.click('button:has-text("Add location"):not(.small)')
        t2 = banner(); assert t2.startswith('Saved'), t2
        return t + ' / ' + t2
    step('Setup: add storage and a site', setup_location)

    def setup_people():
        nav('setup?tab=people')
        page.click('button:has-text("Add person")')
        field('Display name').fill('Medic 1')
        field('Role').select_option('MEDICAL_PROVIDER')
        page.check('label.check-row input')
        field('Works from').select_option(label='Team Alpha site')
        page.click('button:has-text("Add person"):not(.small)')
        t = banner(); assert t.startswith('Saved'), t
        return t
    step('Setup: add a provider with medication authority', setup_people)

    def setup_item_badgtin():
        nav('setup?tab=items')
        page.click('button:has-text("Add item")')
        field('Name').fill('Saline 0.9% 1 L')
        field('Type').select_option('MEDICATION')
        field('Counted in').fill('bag')
        field('Reorder point').fill('10')
        field('Product barcode').fill('00312345678905')
        page.click('button:has-text("Add item"):not(.small)')
        t = page.locator('form .banner.bad').inner_text(); assert 'check digit' in t, t
        field('Product barcode').fill('00312345678906')
        page.click('button:has-text("Add item"):not(.small)')
        page.locator('.banner.ok', has_text='Saved').wait_for(timeout=5000)
        t2 = banner(); assert t2.startswith('Saved'), t2
        return 'bad check digit refused; ' + t2
    step('Setup: add item with product barcode (check digit enforced)', setup_item_badgtin)

    def receive_issue():
        nav('act/receive')
        field('Item').select_option(label='Saline 0.9% 1 L')
        field('Lot number').fill('LOT-001')
        field('Expiration date').fill('2028-06-30')
        field('Quantity').fill('24')
        field('Into location').select_option(label='Pharmacy cage A')
        page.click('button:has-text("Record receipt")')
        t = banner(); assert t.startswith('Recorded'), t
        nav('act/ship')
        field('From').select_option(label='Pharmacy cage A')
        field('Lot').select_option(index=1)
        field('Quantity').fill('10')
        field('To (any hub or site)').select_option(label='Team Alpha site')
        page.click('button:has-text("Record shipment")')
        t2 = banner(); assert t2.startswith('Recorded'), t2
        return t[:80] + ' | ' + t2[:80]
    step('Own data: receive 24 and ship 10 Hawaii → Germany site', receive_issue)

    def scan_own_product():
        nav('scan'); page.click('button.tab:has-text("Handheld scanner")')
        w = page.locator('input.wedge'); w.click(); w.type('00312345678906'); w.press('Enter')
        page.wait_for_selector('.result', timeout=3000)
        h = page.locator('.result h2').inner_text(); assert 'Saline' in h, h
        return f'scanned own product barcode → {h}'
    step('Own data: product barcode resolves to own item', scan_own_product)

    def own_map():
        nav('map'); page.wait_for_selector('svg.worldmap .pin', timeout=15000)
        labels = sorted(page.eval_on_selector_all('text.pin-label', 'els => els.map(e => e.textContent)'))
        assert labels == ['Germany', 'Poland', 'United States'], labels
        assert page.locator('path.link').count() == 1, 'transit line Hawaii → Poland site missing'
        page.locator('text.pin-label', has_text='Poland').locator('xpath=..').click()
        panel = page.locator('section.card', has=page.locator('h2', has_text='Poland')).inner_text()
        assert 'Team Alpha site' in panel and '10 units in transit' in panel, panel
        page.screenshot(path=f'{OUT}/13-own-map.png')
        return f'pins {labels}; Hawaii → Poland transit line; panel shows 10 inbound'
    step('Map: own data pins at country level with transit line', own_map)

    def edit_authority_keeps_history():
        n = events()
        nav('setup?tab=people')
        page.locator('li', has_text='Field test lead').locator('button:has-text("Edit")').click()
        page.uncheck('label.check-row input')
        page.click('button:has-text("Save changes")')
        t = banner(); assert t.startswith('Saved'), t
        page.reload(); page.wait_for_selector('.foot', timeout=10000); page.wait_for_timeout(300)
        assert events() == n, (events(), n)
        return f'authority removed; {n} events still intact after reload'
    step('Changing a person’s authority does not rewrite history', edit_authority_keeps_history)

    def restore():
        nav('about')
        page.set_input_files('label:has-text("Restore from backup") input', f'{OUT}/backup.json')
        t = banner(); assert 'Restored' in t, t
        page.wait_for_timeout(300)
        strip = page.locator('.demo-strip').inner_text()
        assert 'DEMONSTRATION' in strip, strip
        data = json.load(open(f'{OUT}/backup.json'))
        assert events() == len(data['events']), (events(), len(data['events']))
        return f'{t}; {events()} events back; demo mode restored'
    step('Restore from backup replaces device data', restore)

    def mobile_setup():
        m = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        mp = m.new_page(); mp.goto(BASE + '#/setup?tab=items'); mp.wait_for_selector('h1', timeout=15000); mp.wait_for_timeout(500)
        sw = mp.evaluate('document.documentElement.scrollWidth')
        mp.screenshot(path=f'{OUT}/12-mobile-setup.png')
        mp.goto(BASE + '#/act/dispose'); mp.wait_for_timeout(300)
        sw2 = mp.evaluate('document.documentElement.scrollWidth')
        mp.goto(BASE + '#/labels'); mp.wait_for_timeout(1500)
        sw3 = mp.evaluate('document.documentElement.scrollWidth')
        m.close()
        assert max(sw, sw2, sw3) <= 391, (sw, sw2, sw3)
        return f'scrollWidth setup {sw}, dispose {sw2}, labels {sw3} (viewport 390)'
    step('Phone width: new screens fit', mobile_setup)

    browser.close()

print('CONSOLE ERRORS:', errors)
json.dump({'results': results, 'consoleErrors': errors}, open(f'{OUT}/results2.json', 'w'), indent=2)
print(f"{sum(r['ok'] for r in results)}/{len(results)} passed")
