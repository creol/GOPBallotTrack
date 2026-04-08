# BallotTrack DNS Delegation Setup

**Date:** April 8, 2026
**Requested by:** Chris Null
**Project:** BallotTrack — ballot scanning and election management for Utah GOP conventions

---

## What We Need

We have provisioned AWS infrastructure for BallotTrack and need DNS delegation set up so that `ballottrack.utgop.org` and its subdomains resolve to our AWS resources.

A Route 53 **public hosted zone** has been created for `ballottrack.utgop.org`. The following NS records need to be added to the parent zone (`utgop.org`) to delegate authority for this subdomain to AWS.

---

## NS Records to Add

Add the following **NS record set** for `ballottrack` in the `utgop.org` zone:

| Record Name | Type | Value |
|---|---|---|
| `ballottrack.utgop.org` | NS | `ns-1752.awsdns-27.co.uk` |
| `ballottrack.utgop.org` | NS | `ns-15.awsdns-01.com` |
| `ballottrack.utgop.org` | NS | `ns-1495.awsdns-58.org` |
| `ballottrack.utgop.org` | NS | `ns-797.awsdns-35.net` |

All four NS records should be added. TTL can be set to 3600 (1 hour) or your zone default.

---

## What This Enables

Once delegation is active, the following DNS records (already configured in Route 53) will start resolving:

| Record | Type | Points To | Purpose |
|---|---|---|---|
| `dev.ballottrack.utgop.org` | A | `54.187.135.244` | Dev environment server |
| `images-dev.ballottrack.utgop.org` | CNAME | `d24f78oiwm0c1h.cloudfront.net` | Dev ballot image CDN |
| `ballottrack.utgop.org` | A | *(prod — not yet deployed)* | Production server |
| `images.ballottrack.utgop.org` | CNAME | *(prod — not yet deployed)* | Production ballot image CDN |

---

## Verification

After the NS records are added, delegation can be verified with:

```
dig ballottrack.utgop.org NS
```

Expected result should return the four `awsdns` nameservers listed above.

To verify end-to-end resolution of the dev server:

```
dig dev.ballottrack.utgop.org A
```

Expected result: `54.187.135.244`

---

## Notes

- No changes are needed to existing `utgop.org` A, MX, or other records — this only adds a subdomain delegation.
- The Route 53 hosted zone is managed by our AWS account (`343218212983`, us-west-2). No access to this account is needed by the DNS manager.
- Prod records will be added to the same hosted zone later. No additional delegation will be required — the same NS records cover all subdomains under `ballottrack.utgop.org`.

---

## Contact

If you have questions about this request, contact Chris Null.
