"""Seed the Broker App Test workspace in Monday with fictional test records.

Writes only to boards in the Broker App Test workspace (18004807). Records that
already exist by name are skipped, so the script can be re-run safely.

Auth is added to requests by the environment's network secret for
api.monday.com. Run: python3 scripts/seed_test_boards.py
"""

import json
import urllib.request

API = "https://api.monday.com/v2"
WORKSPACE_ID = "18004807"

LEADS = "18435326752"
CONTACTS = "18435326853"
PROPS_OLD = "18435327033"
PROPS_NEW = "18435327265"
PROPERTY_LEADS = "18435327149"
TEST_BOARDS = {LEADS, CONTACTS, PROPS_OLD, PROPS_NEW, PROPERTY_LEADS}

JOHN = 44432289
EMILY = 25374507  # second broker; must be a subscriber on the test boards

PLACES = {
    "Mount Laurel": ("39.9340", "-74.8910", "Mount Laurel, NJ, USA"),
    "Cherry Hill": ("39.9348", "-75.0307", "Cherry Hill, NJ, USA"),
    "Pennsauken": ("39.9562", "-75.0577", "Pennsauken Township, NJ, USA"),
    "Haddonfield": ("39.8915", "-75.0377", "Haddonfield, NJ, USA"),
    "Moorestown": ("39.9689", "-74.9488", "Moorestown, NJ, USA"),
    "Bellmawr": ("39.8676", "-75.0946", "Bellmawr, NJ, USA"),
    "Marlton": ("39.8915", "-74.9218", "Marlton, NJ, USA"),
}


def gql(query, variables=None):
    req = urllib.request.Request(
        API,
        data=json.dumps({"query": query, "variables": variables or {}}).encode(),
        headers={"Content-Type": "application/json", "API-Version": "2025-04"},
    )
    out = json.load(urllib.request.urlopen(req))
    if out.get("errors"):
        raise RuntimeError(json.dumps(out["errors"], indent=2))
    return out["data"]


# Column value helpers
def people(*ids):
    return {"personsAndTeams": [{"id": i, "kind": "person"} for i in ids]}


def label(text):
    return {"label": text}


def labels(*names):
    return {"labels": list(names)}


def place(name):
    lat, lng, address = PLACES[name]
    return {"lat": lat, "lng": lng, "address": address}


def phone(digits):
    return {"phone": digits, "countryShortName": "US"}


def email(address, display=None):
    return {"email": address, "text": display or address}


def date(d):
    return {"date": d}


def checked():
    return {"checked": "true"}


def lead(name, business=None, contact_type=None, property_type=None, budget=None,
         size=None, where=None, notes=None, status=None, follow_up=None, broker=None,
         co_broker=None, ph=None, em=None, source=None, opened=None):
    cv = {
        "text_mkpmr5fe": business,
        "contact_type9": contact_type and label(contact_type),
        "dropdown_mkqsh3rg": property_type and labels(property_type),
        "numeric_mm7yt73y": budget,
        "text_mm7yw1c2": size,
        "location_mkr71a8e": where and place(where),
        "text": notes,
        "color_mkpme1c1": status and label(status),
        "date_mkqpryjm": follow_up and date(follow_up),
        "person": broker and people(broker),
        "people": co_broker and people(co_broker),
        "phone": ph and phone(ph),
        "email": em,
        "label7": source and label(source),
        "date": opened and date(opened),
    }
    return name, cv


def contact(name, business=None, contact_type=None, property_type=None, budget=None,
            size=None, where=None, notes=None, follow_up=None, broker=None,
            co_broker=None, ph=None, em=None, source=None, opened=None):
    cv = {
        "text_mm82gy6x": business,
        "contact_type9": contact_type and label(contact_type),
        "dropdown_mm7yh3e2": property_type and labels(property_type),
        "numeric_mm7y1ep3": budget,
        "text_mm7yvh3n": size,
        "location": where and place(where),
        "text": notes,
        "date_mm3rtdnf": follow_up and date(follow_up),
        "person": broker and people(broker),
        "people": co_broker and people(co_broker),
        "phone": ph and phone(ph),
        "email": em,
        "label7": source and label(source),
        "date": opened and date(opened),
    }
    return name, cv


LEAD_RECORDS = [
    # The spec's capture example. Requirement fields left empty on purpose.
    lead("Dave Reyes", business="Garrison Foods", status="Contacted", broker=JOHN,
         ph="8565550142",
         em=email("dave.reyes@garrisonfoods.example",
                  "dave.reyes@garrisonfoods.example, d.reyes@mail.example"),
         source="Referral", opened="2026-09-02"),
    # Missing fields required before Qualified.
    lead("Sam Whitaker", contact_type="Not Set", status="New Lead", broker=JOHN,
         ph="6095550111", source="Not Set", opened="2026-10-01"),
    # Has every field required before Qualified.
    lead("Linda Park", business="Park Medical Group", contact_type="Leasee",
         property_type="Healthcare", budget=6000, size="4,000 to 5,000 sf",
         where="Cherry Hill", notes="First-floor medical office, ADA access",
         status="Contacted", broker=JOHN, ph="8565550175",
         em=email("linda@parkmedical.example"), source="Referral", opened="2026-08-14"),
    # Also in Contacts.
    lead("Maria Chen", business="Harbor Coffee Co.", contact_type="Leasee",
         property_type="Retail", size="1,200 to 1,800 sf", where="Haddonfield",
         status="Contacted", broker=JOHN, ph="8565550123",
         em=email("maria@harborcoffee.example"), source="Personal Contact",
         opened="2026-06-20"),
    # Unassigned.
    lead("Tom Alvarez", contact_type="Buyer", property_type="Land", where="Marlton",
         notes="Called from the sign at the Route 73 parcel", status="New Lead",
         ph="2155550199", source="Sign", opened="2026-10-09"),
    # Two email addresses in one field.
    lead("Kevin O'Brien", business="O'Brien & Hale Law", contact_type="Leasee",
         property_type="Office", size="2,500 sf", where="Moorestown",
         status="Contacted", broker=JOHN, ph="8565550134",
         em=email("kobrien@obrienhale.example",
                  "kobrien@obrienhale.example; kevin.obrien@mail.example"),
         source="Business Development", opened="2026-07-11"),
    # Owned by another broker.
    lead("Ray Fulton", business="Fulton Logistics", contact_type="Leasee",
         property_type="Industrial", size="12,000 sf", where="Mount Laurel",
         notes="Target rent about $8.50/sf NNN, lease ends Q2 2027",
         status="Contacted", broker=EMILY, ph="6095550152",
         em=email("ray@fultonlogistics.example"), source="Cold Call", opened="2026-05-03"),
    lead("Grace Kim", business="Kim Packaging", contact_type="Leasee",
         property_type="Industrial", size="30,000 to 40,000 sf", where="Pennsauken",
         status="Contacted", follow_up="2026-11-15", broker=JOHN, ph="8565550188",
         em=email("grace@kimpackaging.example"), source="Costar/LoopNet",
         opened="2026-04-22"),
    lead("Andre Wallace", business="Wallace Holdings", contact_type="Property Owner",
         property_type="Investment", where="Marlton", status="New Lead", broker=JOHN,
         ph="6095550163", em=email("andre@wallaceholdings.example"),
         source="Cold Call", opened="2026-10-05"),
    lead("Beth Sullivan", business="Sullivan Bakery", contact_type="Buyer",
         property_type="Retail", budget=650000, size="3,000 sf", where="Mount Laurel",
         status="Contacted", broker=JOHN, ph="8565550147",
         em=email("beth@sullivanbakery.example"), source="Website", opened="2026-09-18"),
    # Emily is Contact Broker, John is Co-Broker.
    lead("Victor Ramos", business="Ramos Auto Group", contact_type="Leasee",
         property_type="Industrial", size="10,000 to 15,000 sf", where="Bellmawr",
         status="Contacted", broker=EMILY, co_broker=JOHN, ph="8565550191",
         em=email("victor@ramosauto.example"), source="Referral", opened="2026-08-30"),
    lead("Jen Ortiz", business="Ortiz Fitness", contact_type="Leasee",
         property_type="Retail", size="5,000 to 8,000 sf", where="Mount Laurel",
         status="Contacted", broker=JOHN, ph="6095550129",
         em=email("jen@ortizfitness.example"), source="Website", opened="2026-09-25"),
]

CONTACT_RECORDS = [
    # Also in Leads, with a different email.
    contact("Maria Chen", business="Harbor Coffee Co.", contact_type="Leasee",
            property_type="Retail", size="1,200 to 1,800 sf", where="Haddonfield",
            follow_up="2026-12-01", broker=JOHN, ph="18565550123",
            em=email("maria.chen@harborcoffee.example"), source="Personal Contact",
            opened="2026-03-10"),
    # The second Dave.
    contact("Dave Morales", business="Brightline Dental", contact_type="Leasee",
            property_type="Healthcare", size="2,000 to 2,500 sf", where="Cherry Hill",
            broker=JOHN, ph="6095550187", em=email("dave@brightlinedental.example"),
            source="Referral", opened="2026-02-17"),
    # Unassigned.
    contact("Helen Brooks", contact_type="Property Owner", property_type="Investment",
            where="Moorestown", ph="8565550166", em=email("helen.brooks@mail.example"),
            source="Business Development", opened="2026-01-29"),
    contact("Marcus Bell", business="Bell Freight", contact_type="Leasee",
            property_type="Industrial", size="18,000 sf", where="Bellmawr",
            notes="Needs 2 dock doors, lease ends Q1 2027", broker=JOHN,
            ph="8565550158", em=email("marcus@bellfreight.example"), source="Cold Call",
            opened="2026-05-12"),
    # Owned by another broker.
    contact("Nina Patel", business="Patel Pharmacy", contact_type="Leasee",
            property_type="Retail", size="2,500 sf", where="Moorestown",
            broker=EMILY, ph="6095550144", em=email("nina@patelpharmacy.example"), source="Referral",
            opened="2026-04-08"),
    contact("Owen Gray", business="Gray Family Properties", contact_type="Property Owner",
            property_type="Industrial", where="Cherry Hill", broker=JOHN,
            ph="8565550170", em=email("owen@grayfamilyprops.example"),
            source="Personal Contact", opened="2025-11-03"),
    contact("Rachel Lin", business="Lin Engineering", contact_type="Leasee",
            property_type="Office", size="6,000 to 8,000 sf", where="Mount Laurel",
            follow_up="2026-10-20", broker=JOHN, ph="6095550138",
            em=email("rachel@linengineering.example"), source="Website",
            opened="2026-06-01"),
]

PROPS_OLD_RECORDS = [
    ("1200 Commerce Pkwy - Mount Laurel", {
        "status": label("On Market - Vantage"), "location": place("Mount Laurel"),
        "person": people(JOHN), "numbers7": 18000, "status_15": label("Lease"),
        "dropdown97": labels("Industrial"), "text5": "NNN"}),
    ("45 Kings Hwy E - Haddonfield", {
        "status": label("On Market - Vantage"), "location": place("Haddonfield"),
        "person": people(JOHN), "numbers7": 1600, "status_15": label("Lease"),
        "dropdown97": labels("Retail"), "text5": "Modified Gross"}),
    ("300 Corporate Center Dr - Mount Laurel", {
        "status": label("On Market - Vantage"), "location": place("Mount Laurel"),
        "person": people(JOHN), "numbers7": 7500, "status_15": label("Lease"),
        "dropdown97": labels("Office"), "text5": "Full Service"}),
    ("7 Industrial Ave - Pennsauken", {
        "status": label("Under Agreement"), "location": place("Pennsauken"),
        "person": people(JOHN), "numbers7": 35000, "numbers": 4200000,
        "status_15": label("Sale"), "dropdown97": labels("Industrial")}),
    ("Route 73 Parcel - Marlton", {
        "status": label("On Market - Vantage"), "location": place("Marlton"),
        "person": people(JOHN), "numbers8": 4.2, "numbers": 1850000,
        "status_15": label("Sale"), "dropdown97": labels("Land"), "checkbox": checked()}),
]


def sensitive_new(key, loans, lender):
    return {"text_mm6dkq1x": key, "text_mm6daeez": loans,
            "boolean_mm6dhjh2": checked(), "text_mm6dwt85": lender}


def suite(name, sqft, status, description, lease_value=None, expires=None):
    return name, {
        "numbers15": sqft, "status6": label(status),
        "dropdown_mkp4t33a": labels(description), "color_mkqy6pz4": label("Lease"),
        "numbers": lease_value, "date_mknyafwd": expires and date(expires),
    }


PROPS_NEW_RECORDS = [
    ("Garrison Business Center - Mount Laurel", {
        "status": label("On Market - Vantage"), "location": place("Mount Laurel"),
        "person": people(JOHN), "status_15": label("Lease"),
        **sensitive_new("Lockbox 4412 on rear door", "$1,250,000",
                        "First Example Bank, Pat Lee, 856-555-0110")},
     [suite("Suite A", 15000, "On Market", "Industrial", 135000),
      suite("Suite B", 8000, "Lease Signed", "Industrial", 76000, "2028-06-30"),
      suite("Suite C", 20000, "On Market", "Industrial", 170000)]),
    # Owned by Emily, to test hiding the sensitive fields.
    ("Kings Crossing Retail Plaza - Haddonfield", {
        "status": label("Partially Leased"), "location": place("Haddonfield"),
        "person": people(EMILY),
        "status_15": label("Lease"),
        **sensitive_new("Code 2290 at management office", "$2,100,000",
                        "Example Savings Bank, Chris Dunn, 609-555-0177")},
     [suite("Suite 101", 1400, "On Market", "Retail", 33600),
      suite("Suite 102", 2200, "Lease Signed", "Retail", 52800, "2027-09-30")]),
    ("Route 38 Flex Center - Moorestown", {
        "status": label("On Market - Vantage"), "location": place("Moorestown"),
        "person": people(JOHN), "status_15": label("Sale or Lease"),
        **sensitive_new("Lockbox 8120 by Unit 1 door", "$640,000",
                        "Example Credit Union, Sam Ortiz, 856-555-0105")},
     [suite("Unit 1", 6500, "On Market", "Industrial", 61750),
      suite("Unit 2", 4000, "LOI - In Progress", "Industrial", 38000)]),
]


def property_lead(name, broker, listing_type, where, county, zip_code, price,
                  property_type, key, loans, lender, owner=None):
    cv = {
        "person": broker and people(broker), "color_mkns3611": label(listing_type),
        "location_mkns33qb": place(where), "text_mkpfsz8c": county,
        "text_mkpf5568": zip_code, "text_mm6vgmah": price,
        "color_mm6vsvqf": label(property_type), "text_mm6v7x34": key,
        "text_mm6v4ft7": loans, "boolean_mm6v34ps": checked(), "text_mm6v4b1z": lender,
    }
    return name, cv, owner


PROPERTY_LEAD_RECORDS = [
    property_lead("22 Elm St Warehouse - Cherry Hill", JOHN, "Lease", "Cherry Hill",
                  "Camden", "08002", "$12/sf NNN", "Industrial/Flex",
                  "Code 7781 side door", "$480,000",
                  "Example Bank, Dana Price, 856-555-0119", owner="Owen Gray"),
    # Owned by another broker.
    property_lead("510 Main St Office Condo - Moorestown", EMILY, "Sale", "Moorestown",
                  "Burlington", "08057", "$625,000", "Office",
                  "Key at front desk", "$210,000",
                  "Example Credit Union, Lee Shaw, 609-555-0124"),
]


def existing_names(board_id):
    data = gql("query($b:[ID!]){boards(ids:$b){workspace{id} items_page(limit:500){items{id name}}}}",
               {"b": [board_id]})
    board = data["boards"][0]
    assert board["workspace"]["id"] == WORKSPACE_ID, f"{board_id} is not in the test workspace"
    return {i["name"]: i["id"] for i in board["items_page"]["items"]}


def clean(cv):
    return {k: v for k, v in cv.items() if v is not None}


def create(board_id, name, cv, existing):
    assert board_id in TEST_BOARDS
    if name in existing:
        print(f"  skip   {name} ({existing[name]})")
        return existing[name]
    data = gql("mutation($b:ID!,$n:String!,$c:JSON!){create_item(board_id:$b,item_name:$n,column_values:$c,create_labels_if_missing:false){id}}",
               {"b": board_id, "n": name, "c": json.dumps(clean(cv))})
    item_id = data["create_item"]["id"]
    print(f"  create {name} ({item_id})")
    return item_id


def create_suites(parent_id, suites):
    have = gql("query($i:[ID!]){items(ids:$i){subitems{name}}}", {"i": [parent_id]})
    have = {s["name"] for s in have["items"][0]["subitems"] or []}
    for name, cv in suites:
        if name in have:
            continue
        gql("mutation($p:ID!,$n:String!,$c:JSON!){create_subitem(parent_item_id:$p,item_name:$n,column_values:$c){id}}",
            {"p": parent_id, "n": name, "c": json.dumps(clean(cv))})
        print(f"    suite {name}")


def main():
    ids = {}
    for title, board, records in [("Leads", LEADS, LEAD_RECORDS),
                                  ("Contacts", CONTACTS, CONTACT_RECORDS),
                                  ("Properties (old)", PROPS_OLD, PROPS_OLD_RECORDS)]:
        print(title)
        existing = existing_names(board)
        ids[title] = {name: create(board, name, cv, existing) for name, cv in records}

    print("Properties New")
    existing = existing_names(PROPS_NEW)
    ids["Properties New"] = {}
    for name, cv, suites in PROPS_NEW_RECORDS:
        item_id = create(PROPS_NEW, name, cv, existing)
        create_suites(item_id, suites)
        ids["Properties New"][name] = item_id

    print("Property Leads")
    existing = existing_names(PROPERTY_LEADS)
    ids["Property Leads"] = {}
    for name, cv, owner in PROPERTY_LEAD_RECORDS:
        if owner:
            cv["board_relation_mknsc95n"] = {"item_ids": [int(ids["Contacts"][owner])]}
        ids["Property Leads"][name] = create(PROPERTY_LEADS, name, cv, existing)

    with open("docs/test-records.json", "w") as f:
        json.dump(ids, f, indent=2)
        f.write("\n")


if __name__ == "__main__":
    main()
