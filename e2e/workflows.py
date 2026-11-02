"""Browser smoke test of FieldLine workflows. Usage: python3 smoke.py BASE_URL OUTDIR"""
import re, sys, json
from playwright.sync_api import sync_playwright, expect

BASE = sys.argv[1].rstrip('/') + '/'
OUT = sys.argv[2]
results = []
errors = []

def step(name, fn):
    try:
        detail = fn()
        results.append({'step': name, 'ok': True, 'detail': detail or ''})
        print('PASS', name, detail or '')
    except Exception as e:
        results.append({'step': name, 'ok': False, 'detail': str(e)[:400]})
        print('FAIL', name, str(e)[:400])

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=['--no-sandbox'])
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900})
    page = ctx.new_page()
    page.on('console', lambda m: m.type == 'error' and errors.append(m.text))
    page.on('pageerror', lambda e: errors.append(str(e)))

    def nav(h):
        page.goto(BASE + '#/' + h)
        page.wait_for_timeout(250)

    def act_as(pid):
        page.select_option('select[aria-label="Acting as"]', pid)

    def scope(s):
        page.select_option('select[aria-label="Hub scope"]', s)

    def banner():
        b = page.locator('.banner.ok, .banner.bad').last
        b.wait_for(timeout=4000)
        return b.inner_text()

    def field(label):
        return page.locator('label.field', has=page.locator('.field-label', has_text=re.compile('^' + re.escape(label)))).locator('select, input').first

    def load():
        page.goto(BASE)
        page.wait_for_selector('.tiles', timeout=15000)
        page.screenshot(path=f'{OUT}/01-dashboard.png', full_page=True)
        return page.locator('.foot').inner_text()
    step('Load dashboard (enterprise) with seeded two-hub data', load)

    def hubs():
        assert page.locator('text=Hubs side by side').count() == 1
        heads = [h.lower() for h in page.locator('table thead th').all_inner_texts()]
        assert 'hawaii hub' in heads and 'germany hub' in heads, heads
        scope('HUB-DE'); page.wait_for_timeout(200)
        h = page.locator('h1').inner_text()
        assert h == 'Germany Hub', h
        page.screenshot(path=f'{OUT}/02-germany.png', full_page=True)
        scope('ALL')
        return 'enterprise comparison table + Germany scope'
    step('Hub scoping: enterprise vs Germany', hubs)

    def inv():
        nav('inventory')
        assert page.locator('h2', has_text='Ondansetron').count() == 1
        rows = page.locator('tr.row-bad').count()
        assert rows >= 1, 'expired lot row not highlighted'
        page.screenshot(path=f'{OUT}/03-inventory.png', full_page=True)
        nav('inventory?exp=EXPIRED')
        assert page.locator('a', has_text='E880').count() == 1
        return f'{rows} expired row(s) highlighted; expired filter works'
    step('Inventory by lot and expiry', inv)

    def issue_ok():
        act_as('p-kalani')
        nav('act/issue?from=HI-PHARM&lot=lot-ond-hi1')
        field('Issue to').select_option('p-tanaka')
        field('Quantity').fill('2')
        field('Purpose').fill('Smoke test issue')
        page.click('button:has-text("Record issue")')
        t = banner(); assert t.startswith('Recorded'), t
        return t
    step('Issue 2 vials to provider (Kalani → Tanaka)', issue_ok)

    def issue_expired():
        nav('act/issue?from=HI-PHARM&lot=lot-epi-hi-old')
        field('Issue to').select_option('p-tanaka')
        page.click('button:has-text("Record issue")')
        t = banner(); assert 'expired' in t, t
        return t
    step('Issue of expired lot is refused', issue_expired)

    def witness_required():
        nav('act/issue?from=HI-PHARM&lot=lot-ket-hi')
        field('Issue to').select_option('p-tanaka')
        page.click('button:has-text("Record issue")')
        t = banner(); assert 'witness' in t.lower(), t
        return t
    step('Ketamine issue without witness is refused', witness_required)

    def no_med_auth():
        nav('act/issue?from=HI-PHARM&lot=lot-ond-hi1')
        field('Issue to').select_option('p-okafor')
        page.click('button:has-text("Record issue")')
        t = banner(); assert 'not authorized' in t, t
        return t
    step('Medication issue to person without authority is refused', no_med_auth)

    def consume():
        act_as('p-tanaka')
        nav('act/consume?person=p-tanaka&lot=lot-ond-hi1')
        field('Quantity').fill('1')
        field('De-identified encounter reference').fill('ENC-SMOKE-1')
        page.click('button:has-text("Record use")')
        t = banner(); assert t.startswith('Recorded'), t
        return t
    step('Consume 1 (Tanaka, patient care)', consume)

    def consume_pii():
        nav('act/consume?person=p-tanaka&lot=lot-ond-hi1')
        field('De-identified encounter reference').fill('John Smith')
        page.click('button:has-text("Record use")')
        t = banner(); assert 'never a name' in t, t
        return t
    step('Encounter reference with a name is refused', consume_pii)

    def waste():
        nav('act/waste?person=p-tanaka&lot=lot-ond-hi1')
        field('Quantity').fill('1')
        field('Reason').fill('Smoke test: contaminated')
        page.click('button:has-text("Record waste")')
        t = banner(); assert t.startswith('Recorded'), t
        return t
    step('Waste 1 (Tanaka)', waste)

    def ret():
        nav('act/return?person=p-tanaka&lot=lot-ond-hi1')
        field('Quantity').fill('1')
        page.click('button:has-text("Return to stock")')
        t = banner(); assert 'pending' in t, t
        return t
    step('Return 1 (Tanaka → Site Koa, pending)', ret)

    def accept_self():
        nav('act/accept')
        page.click('button:has-text("Accept return")')
        t = banner(); assert t.startswith('Not recorded') and ('someone other' in t or 'may not record RETURN_ACCEPT' in t), t
        return t
    step('Provider (the returner) cannot accept a return — refused', accept_self)

    def accept_other():
        act_as('p-reyes')
        nav('act/accept')
        field('Disposition').select_option('QUARANTINE')
        page.click('button:has-text("Accept return")')
        t = banner(); assert t.startswith('Recorded'), t
        return t
    step('Accept return by different person (Reyes, quarantine)', accept_other)

    def hub_transfer_receive():
        act_as('p-kalani')
        nav('act/transfer-receive')
        field('Quantity counted on arrival').fill('5')
        page.click('button:has-text("Record receipt")')
        t = banner(); assert t.startswith('Recorded') and 'Hawaii' in t, t
        return t
    step('Receive Germany → Hawaii hub transfer (Kalani)', hub_transfer_receive)

    def ship_hub():
        nav('act/ship?from=HI-WH')
        field('Lot').select_option('lot-gauze-hi')
        field('Quantity').fill('10')
        field('To (any hub or site)').select_option('DE-WH')
        page.click('button:has-text("Record shipment")')
        t = banner(); assert t.startswith('Recorded'), t
        act_as('p-kalani')
        nav('act/transfer-receive')
        return t
    step('Ship Hawaii → Germany hub transfer', ship_hub)

    def recv_short():
        act_as('p-weber')
        scope('HUB-DE')
        nav('act/transfer-receive')
        field('Quantity counted on arrival').fill('8')
        page.click('button:has-text("Record receipt")')
        t = banner(); assert '2 short' in t, t
        scope('ALL')
        return t
    step('Germany receives 8 of 10 → 2 recorded missing', recv_short)

    def equip():
        act_as('p-kalani')
        nav('equipment?asset=as-hi-2')
        page.click('button:has-text("I can see it here")')
        t = banner(); assert t.startswith('Recorded'), t
        page.screenshot(path=f'{OUT}/05-equipment.png', full_page=True)
        return t
    step('Confirm equipment location (overdue ventilator)', equip)

    def label():
        nav('labels?type=ASSET&target=as-de-1')
        page.click('button:has-text("Issue label and add to sheet")')
        t = banner(); assert t.startswith('Recorded'), t
        page.wait_for_selector('.sheet .label .qr svg', timeout=5000)
        code = page.locator('.sheet .label code').first.inner_text()
        page.locator('.sheet .label').first.screenshot(path=f'{OUT}/label.png')
        page.screenshot(path=f'{OUT}/06-labels.png', full_page=True)
        return code
    step('Generate QR label for equipment', label)
    label_code = results[-1]['detail'] if results[-1]['ok'] else None

    def manual_scan():
        nav('scan')
        page.click('button.tab:has-text("Type it in")')
        page.fill('label.field input', label_code.lower().replace('-', ''))
        page.click('button:has-text("Look up")')
        page.wait_for_selector('.result', timeout=3000)
        t = page.locator('.result h2').inner_text()
        assert 'suction' in t.lower(), t
        return f'typed lowercase/no dashes → {t}'
    step('Manual entry resolves new label', manual_scan)

    def wedge():
        page.click('button.tab:has-text("Handheld scanner")')
        w = page.locator('input.wedge')
        w.click()
        w.type('(01)02000000010014(17)281231(10)NEWLOT9', delay=5)
        w.press('Enter')
        page.wait_for_selector('.result', timeout=3000)
        t = page.locator('.result h2').inner_text()
        assert 'new lot' in t.lower(), t
        page.click('a:has-text("Receive this lot")')
        page.wait_for_timeout(200)
        assert field('Lot number').input_value() == 'NEWLOT9'
        assert field('Expiration date').input_value() == '2028-12-31'
        field('Into location').select_option('HI-PHARM')
        field('Quantity').fill('12')
        page.click('button:has-text("Record receipt")')
        b = banner(); assert b.startswith('Recorded'), b
        return f'{t} → receive prefilled → {b[:90]}'
    step('Handheld (keyboard-wedge, simulated keystrokes) GS1 → new lot → receive', wedge)

    def photo_scan():
        nav('scan')
        page.click('button.tab:has-text("Camera")')
        page.set_input_files('.file-btn input', f'{OUT}/label.png')
        page.wait_for_selector('.result', timeout=15000)
        t = page.locator('.result h2').inner_text()
        src = page.locator('.result .sub').first.inner_text()
        assert 'suction' in t.lower(), t
        return f'{src} → {t}'
    step('Camera decoder (zxing-wasm) reads QR from photo', photo_scan)

    def history():
        nav('history')
        n = page.locator('.history li').count()
        top = page.locator('.history li').first.inner_text()
        assert 'Received 12' in top or 'NEWLOT9' in top, top
        page.screenshot(path=f'{OUT}/07-history.png')
        return f'{n} rows shown; newest: {top.splitlines()[0]}'
    step('Transaction history shows new events newest first', history)

    def persist():
        before = page.locator('.foot').inner_text()
        page.reload(); page.wait_for_selector('.foot', timeout=10000); page.wait_for_timeout(300)
        after = page.locator('.foot').inner_text()
        m1 = re.search(r'(\d+) ledger events', before).group(1); m2 = re.search(r'(\d+) ledger events', after).group(1)
        assert m1 == m2, (before, after)
        return f'{m2} events before and after reload'
    step('Persistence across reload (IndexedDB)', persist)

    def lot_page():
        nav('lot/lot-ond-hi1')
        t = page.locator('.check').inner_text()
        assert t.startswith('✓'), t
        page.screenshot(path=f'{OUT}/04-lot.png', full_page=True)
        return t
    step('Lot detail conservation check passes after all transactions', lot_page)

    def demo_map():
        nav('map'); page.wait_for_selector('svg.worldmap .pin', timeout=15000)
        labels = sorted(page.eval_on_selector_all('text.pin-label', 'els => els.map(e => e.textContent)'))
        assert labels == ['Germany', 'Philippines', 'Poland', 'United States'], labels
        rows = page.locator('table tbody tr').count()
        return f'{len(labels)} country pins, {rows} rows in the by-country table'
    step('Map shows demo stock by country', demo_map)

    def mobile():
        m = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        mp = m.new_page()
        mp.goto(BASE); mp.wait_for_selector('.tiles', timeout=15000)
        sw = mp.evaluate('document.documentElement.scrollWidth'); cw = mp.evaluate('document.documentElement.clientWidth')
        mp.screenshot(path=f'{OUT}/08-mobile.png', full_page=False)
        mp.goto(BASE + '#/act/issue'); mp.wait_for_timeout(300)
        mp.screenshot(path=f'{OUT}/09-mobile-issue.png', full_page=False)
        m.close()
        assert sw <= cw + 1, f'horizontal overflow {sw}>{cw}'
        return f'scrollWidth {sw} = clientWidth {cw}'
    step('Phone viewport (390 px): no horizontal overflow', mobile)

    browser.close()

print('CONSOLE ERRORS:', errors)
json.dump({'results': results, 'consoleErrors': errors}, open(f'{OUT}/results.json', 'w'), indent=2)
print(f"{sum(r['ok'] for r in results)}/{len(results)} passed")
