import os
import httpx

config = {"schedule": "0 10 * * *"}


def handler(event, context):
    resp = httpx.post(
        f"{os.environ['SITE_URL']}/api/cron/tick",
        headers={"x-cron-secret": os.environ["CRON_SECRET"]},
        timeout=30,
    )
    return {"statusCode": 200, "body": resp.text}
