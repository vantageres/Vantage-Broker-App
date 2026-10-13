# Monday Test Boards

Read from the Monday API on Oct 13, 2026. Workspace **Broker App Test** (`18004807`).

## Boards

| Board | ID | Subitems board | Items |
| --- | --- | --- | --- |
| Vantage Leads Test | 18435326752 | 18435326758 | 0 |
| Vantage Contacts Test | 18435326853 | 18435326856 | 1 |
| Vantage Properties Test (old) | 18435327033 | 18435327048 | 0 |
| Vantage Properties New Test | 18435327265 | 18435327273 | 0 |
| Property Leads Test | 18435327149 | 18435327156 | 0 |

Live boards referenced by test link columns (Main workspace): Vantage Contacts `8842962019`, Subitems of Vantage Contacts `8842962360`, Vantage Properties `5076736644`, Back Office - Vouchers `5024344343`, Silver Listings `18424931015`.

Custom activity type **Broker Note**: `a087433e-74e8-45bb-9a91-a16346e18fbc`.

## Key columns: Leads and Contacts

| Field | Leads Test | Contacts Test |
| --- | --- | --- |
| Business Name | `text_mkpmr5fe` | `text_mm82gy6x` |
| Contact Type | `contact_type9` (… Not Set) | `contact_type9` (… Not Labeled) |
| Property Type | `dropdown_mkqsh3rg` | `dropdown_mm7yh3e2` |
| Budget | `numeric_mm7yt73y` | `numeric_mm7y1ep3` |
| Sq Ft/Acres | `text_mm7yw1c2` | `text_mm7yvh3n` |
| Desired Location | `location_mkr71a8e` | `location` |
| Notes | `text` | `text` |
| Status | `color_mkpme1c1` (Contacted, Qualified, Unqualified, Error - See Message, New Lead) | none |
| Follow Up Date | `date_mkqpryjm` | `date_mm3rtdnf` |
| Contact Broker | `person` | `person` |
| Co-Broker/s | `people` | `people` |
| Phone | `phone` | `phone` |
| Email | `email` | `email` |
| Associated Properties | `board_relation_mkr7eesb` | `connect_boards7` |
| Source | `label7` | `label7` |
| Referral Source | `text_mkr775sj` | `text5` |
| Open Contact Date | `date` | `date` |
| Files | `file_mm82xcfx` | `file_mm82c8v0` |
| Leads only | Last Contact `date_mkqp6m0y` | |
| Contacts only | | Contact Address `location_mkqhcmz4`, Follow Up Set `multiple_person_mm3rsn89` |

## Ownership columns

- Properties New Test: Broker `person`, Co-Broker `people`, Co-Broker2 `multiple_person_mm6dtf87`.
- Property Leads Test: Broker `person`, Co-Broker `multiple_person_mkpf12z8`, Co-Broker2 `multiple_person_mm6vg1j1`. Status `status`; LA Signed date `date_mkqetpd`.

## Sensitive columns (shown only to assigned brokers)

| Field | Properties New Test | Property Leads Test |
| --- | --- | --- |
| Key for Broker | `text_mm6dkq1x` | `text_mm6v7x34` |
| Outstanding Loans Amount | `text_mm6daeez` | `text_mm6v4ft7` |
| Current On Loan Payments | `boolean_mm6dhjh2` | `boolean_mm6v34ps` |
| Lender Name & Contact Info | `text_mm6dwt85` | `text_mm6v4b1z` |

## Issues found

1. Link columns on the test boards still point at live boards:
   - Leads Test and Contacts Test, Associated Properties → live Vantage Properties.
   - Property Leads Test, Vantage Contacts → live Vantage Contacts.
   - Properties New Test, Property Owner, Leads, and the suite Deal Contact and Outside Broker → live Vantage Contacts.
   - Properties Test (old), Property Owner and Leads → live Vantage Contacts. Leads/Deals → live and test Contacts subitems. Back Office, Vouchers, and Silver Listing → live boards.
   - Contacts Test subitems, Vantage Properties → live and test Vantage Properties.
2. Vantage Properties New Test has no items. The plan was to copy its 18 items with suites.
3. The Requirements subitem column set still exists on Contacts Test (to be retired).
4. Property Type options differ on Property Leads (Office, Retail, Industrial/Flex, Land, Farm/Agricultural, Multifamily, Mixed-Use, Other) from Leads and Contacts.
5. Automations can't be read through the API. They need a manual check in Monday.
