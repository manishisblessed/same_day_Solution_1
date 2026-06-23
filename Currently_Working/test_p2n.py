import urllib.request, json, time

SECRET = "OGQwZjBlODVhNWZjOWNjMDQeo9AVzLNF7nGEtMCa6wQ="
OUTLET_ID = 10820

payload = {
    "number": "1266",
    "amount": 200,
    "product_code": "4001",
    "request_id": f"SDS{int(time.time())}",
    "bill_fetch_ref": "OC1U1TH6PNXPGPMSWDXY2PFJSQ861741250",
    "optional1": "9971969046",
    "optional2": "",
    "optional3": "",
    "optional4": "",
    "customer_number": "9971969046",
    "pincode": "414002",
    "latitude": "19.1258",
    "longitude": "74.7453",
    "ip": "15.207.31.125",
    "outletId": str(OUTLET_ID),
}

print("=" * 60)
print("Pay2New - SBI Card Bill Payment (Rs.200)")
print("=" * 60)
print(f"\nRequest: {json.dumps(payload, indent=2)}")

data = json.dumps(payload).encode()
req = urllib.request.Request(
    "https://pay2new.in/apis/v1/billPayment",
    data=data,
    headers={"Content-Type": "application/json", "Accept": "application/json", "secret": SECRET},
)
try:
    resp = urllib.request.urlopen(req, timeout=120)
    r = json.loads(resp.read().decode())
except urllib.error.HTTPError as e:
    r = {"http_error": e.code, "body": e.read().decode()}
except Exception as e:
    r = {"error": str(e)}

print(f"\nResponse: {json.dumps(r, indent=2)}")
