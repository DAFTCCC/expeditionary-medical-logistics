# Field test guide

FieldLine is for **logistics data only** — stock, lots, expiry, custody, equipment. Never record patient information. Each device keeps its own records; there is no sync between devices yet.

## Before you go
1. Open <https://daftccc.github.io/expeditionary-medical-logistics/> on each phone/tablet **with a connection**. Wait until the footer says **works offline ✓**.
2. Install it: iPhone/iPad Safari → Share → *Add to Home Screen*; Android Chrome → ⋮ → *Install app*.
3. About → **Start my own field test** (or keep the demo to practise). Then Setup → add locations, people (display names only), and items (scan the box barcode into “Product barcode”).
4. Transact → Receive your starting stock. Setup → Register equipment. Labels → print labels for anything without a barcode.
5. About → **Export backup** at the end of every day. Clearing browser data erases the device.

## What to try, and what to note
| Try | Note |
|---|---|
| Airplane mode on; open the app; record transactions | Does it open and save with no signal? |
| Camera scan of package barcodes (DataMatrix on drugs, UPC on supplies) and FieldLine labels | Speed, lighting, distance, glare, gloves |
| Handheld scanner in Scan → Handheld | Does it read? Does it send GS1 separators (try the substitute setting)? |
| Issue → use / waste / return → accept, between two people | Does the flow match how custody really changes hands? |
| Witnessed items, expired stock, quarantine → disposal | Are the rules right for your operation? |
| Hub-to-hub and hub-to-site transfers; count what arrives | Shortfall handling |
| Equipment confirm / reassign | Is “last confirmed” useful? |
| Print a label sheet | Size, durability, scan from print |

Record problems with what you tapped, what you expected, and a screenshot. Export a backup when something looks wrong so it can be reproduced.

## Known limits
No sign-in (“Acting as” is a switch); witnesses are selected not authenticated; roles are not per hub; no box → each conversions; no sync. See docs/STATUS.md.
