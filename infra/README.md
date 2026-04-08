# BallotTrack AWS CDK Infrastructure

Infrastructure-as-code for deploying BallotTrack to AWS. Creates two fully isolated environments (`dev` and `prod`) with EC2, RDS PostgreSQL, S3, CloudFront, ECR, Route 53, and CI/CD via GitHub Actions OIDC.

## Architecture Overview

```
                    ┌─────────────────────────────────────────────┐
                    │              Shared Stack                    │
                    │  Route 53 Hosted Zone  ·  GitHub OIDC Role  │
                    └───────────────┬─────────────────────────────┘
                                    │
              ┌─────────────────────┴─────────────────────┐
              │                                           │
    ┌─────────┴──────────┐                    ┌───────────┴────────┐
    │   BallotTrack-dev  │                    │  BallotTrack-prod  │
    │                    │                    │                    │
    │  VPC (2 AZs)       │                    │  VPC (2 AZs)       │
    │  EC2  t3.micro     │                    │  EC2  t3.large     │
    │  RDS  db.t3.micro  │                    │  RDS  db.t3.medium │
    │  S3  (DESTROY)     │                    │  S3  (RETAIN)      │
    │  CloudFront + OAC  │                    │  CloudFront + OAC  │
    │  ECR               │                    │  ECR               │
    │  Scheduler (stop)  │                    │                    │
    │  DevStart Lambda   │                    │                    │
    └────────────────────┘                    └────────────────────┘
```

## Prerequisites

1. **Node.js** >= 18
2. **AWS CDK CLI**: `npm install -g aws-cdk`
3. **AWS CLI** v2 configured with credentials for the target account
4. **Docker** (required by CDK for Lambda bundling if esbuild is unavailable)

## Quick Start

### 1. Install dependencies

```bash
cd infra
npm install
```

### 2. Create your context file

```bash
cp cdk.context.example.json cdk.context.json
```

Edit `cdk.context.json` with your values:

| Key | Description | Example |
|-----|-------------|---------|
| `awsAccountId` | AWS account ID | `123456789012` |
| `awsRegion` | AWS region | `us-west-2` |
| `allowedSshCidr` | Your IP for SSH access | `203.0.113.1/32` |
| `domainName` | Your domain | `ballottrack.utgop.org` |
| `githubRepo` | GitHub repo | `yourorg/ballottrack` |
| `devStartApiKey` | API key for dev start endpoint | `openssl rand -hex 32` |

> **Security**: `cdk.context.json` is gitignored. Never commit it.

### 3. Bootstrap CDK (first time only)

CDK bootstrap creates a staging bucket and roles in your AWS account:

```bash
npx cdk bootstrap aws://YOUR_ACCOUNT_ID/YOUR_REGION
```

If using an IAM Organizations managed account, you may need to bootstrap with the `--trust` flag or use an admin role. See [CDK bootstrapping docs](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html).

### 4. Deploy dev environment

```bash
npx cdk deploy --all --context env=dev
```

This deploys two stacks:
- `BallotTrack-shared` — Route 53 hosted zone + GitHub OIDC role
- `BallotTrack-dev` — All dev environment resources

### 5. Deploy prod environment

```bash
npx cdk deploy --all --context env=prod
```

This deploys/updates the shared stack and creates:
- `BallotTrack-prod` — All prod environment resources

### 6. Set up DNS delegation

After deploying, copy the Route 53 nameservers from the `BallotTrack-shared` stack output (`Route53NameServers`) and provide them to your external DNS manager as NS records for your domain.

Example output:
```
BallotTrack-shared.Route53NameServers = ns-123.awsdns-45.com, ns-678.awsdns-90.net, ...
```

Add these as NS records at your domain registrar or parent DNS zone.

### 7. Populate app secrets

After deploy, create the application secrets in Secrets Manager:

```bash
aws secretsmanager put-secret-value \
  --secret-id ballottrack/dev/app-secrets \
  --secret-string '{"JWT_SECRET":"your-jwt-secret","ADMIN_PIN":"1234"}'

aws secretsmanager put-secret-value \
  --secret-id ballottrack/prod/app-secrets \
  --secret-string '{"JWT_SECRET":"your-prod-jwt-secret","ADMIN_PIN":"change-me"}'
```

### 8. Retrieve SSH key

The SSH private key is stored in SSM Parameter Store. Get it with:

```bash
aws ssm get-parameter \
  --name /ec2/keypair/key-XXXXXXXXXXXX \
  --with-decryption \
  --query Parameter.Value \
  --output text > ballottrack-dev.pem

chmod 400 ballottrack-dev.pem
```

The exact parameter name is in the stack output (`devSshKeyParam` or `prodSshKeyParam`).

## Teardown

### Destroy dev (clean removal)

```bash
npx cdk destroy BallotTrack-dev --context env=dev
```

Dev resources use `DESTROY` removal policies — S3 bucket, ECR repo, and RDS are fully deleted.

### Destroy prod (protected)

```bash
npx cdk destroy BallotTrack-prod --context env=prod
```

Prod has `RETAIN` removal policies on critical resources. After `cdk destroy`:

| Resource | What happens |
|----------|-------------|
| S3 bucket | **Retained** — must delete manually in AWS console |
| RDS instance | **Retained** — must delete manually |
| Elastic IP | **Retained** — must release manually |
| ECR repo | **Retained** — must delete manually |
| Everything else | Deleted by CloudFormation |

### Destroy shared stack

Only destroy after both env stacks are removed:

```bash
npx cdk destroy BallotTrack-shared --context env=dev
```

## Starting Dev On Demand

Dev is auto-stopped every evening and on weekends. To start it:

### Via curl

```bash
curl -X POST https://YOUR_API_ID.execute-api.YOUR_REGION.amazonaws.com/v1/start \
  -H "x-api-key: YOUR_DEV_START_API_KEY"
```

The API URL is in the stack output (`DevStartApiUrl`).

### Browser bookmarklet

Create a bookmark with this URL (replace the values):

```javascript
javascript:void(fetch('https://YOUR_API_ID.execute-api.YOUR_REGION.amazonaws.com/v1/start',{method:'POST',headers:{'x-api-key':'YOUR_DEV_START_API_KEY'}}).then(r=>r.json()).then(d=>alert(JSON.stringify(d))).catch(e=>alert('Error: '+e)))
```

### From GitHub Actions

The GitHub Actions role has permission to start the dev EC2 and RDS instances. Your CI workflow can call `ec2:StartInstances` and `rds:StartDBInstance` before deploying.

## Manually Managing Prod

Prod has no auto-stop schedule. Around convention events, manage it manually:

### Stop prod (save costs between events)

```bash
# Stop EC2
aws ec2 stop-instances --instance-ids i-XXXXXXXXXXXXXXXXX

# Stop RDS
aws rds stop-db-instance --db-instance-identifier ballottrack-prod
```

### Start prod (before an event)

```bash
# Start RDS first (takes ~5 minutes)
aws rds start-db-instance --db-instance-identifier ballottrack-prod

# Start EC2
aws ec2 start-instances --instance-ids i-XXXXXXXXXXXXXXXXX
```

> **Note**: RDS auto-starts after 7 days if stopped. AWS does not allow indefinite stops.

## Auto-Stop Schedule (Dev Only)

| Schedule | Action |
|----------|--------|
| Mon–Fri 8:00 PM Mountain | Stop EC2 |
| Sat–Sun 6:00 AM Mountain | Stop EC2 (catches manual weekend starts) |

Timezone: `America/Denver` (observes DST).

## Project Structure

```
infra/
├── bin/
│   └── ballottrack.ts           # CDK app entry point
├── lib/
│   ├── ballottrack-stack.ts     # Environment stack (parameterized)
│   ├── shared-stack.ts          # Shared: Route 53 + GitHub OIDC
│   └── constructs/
│       ├── networking.ts        # VPC, subnets, security groups
│       ├── compute.ts           # EC2, Elastic IP, instance profile
│       ├── database.ts          # RDS PostgreSQL
│       ├── storage.ts           # S3 bucket
│       ├── cdn.ts               # CloudFront distribution + OAC
│       ├── dns.ts               # Route 53 A + CNAME records
│       ├── ecr.ts               # ECR repository
│       ├── iam.ts               # GitHub OIDC provider + role
│       ├── scheduler.ts         # EventBridge Scheduler (auto-stop)
│       └── devstart.ts          # Lambda + API Gateway (dev start)
├── lambda/
│   └── dev-start/
│       └── index.ts             # Lambda: start EC2 + RDS
├── cdk.json                     # CDK app config + feature flags
├── cdk.context.example.json     # Template for context variables
├── cdk.context.json             # Your values (gitignored)
├── tsconfig.json
├── package.json
└── .gitignore
```

## CloudFormation Outputs Summary

| Output | Stack | Description |
|--------|-------|-------------|
| `Route53NameServers` | shared | NS records for DNS delegation |
| `GitHubActionsRoleArn` | shared | IAM role for GitHub Actions OIDC |
| `{env}ElasticIp` | env | EC2 public IP address |
| `{env}RdsEndpoint` | env | RDS connection endpoint |
| `{env}S3BucketName` | env | S3 bucket for ballot images |
| `{env}CloudFrontDomain` | env | CloudFront distribution domain |
| `{env}EcrRepositoryUri` | env | ECR repository URI |
| `{env}SshKeyParam` | env | SSM path for SSH private key |
| `DevStartApiUrl` | dev | API Gateway URL for dev start |
| `DevStartApiKeyName` | dev | API key name in console |

## Troubleshooting

**CDK bootstrap fails**: Ensure your AWS CLI credentials have admin access to the target account. For org managed accounts, you may need to assume a role first.

**GitHub OIDC provider already exists**: If another project already created the GitHub OIDC provider in this account, edit `lib/constructs/iam.ts` and replace the `OpenIdConnectProvider` with `fromOpenIdConnectProviderArn()`. See the comment in that file.

**esbuild not found**: The DevStart Lambda is bundled with esbuild. If not installed locally, CDK falls back to Docker. Ensure Docker is running or install esbuild: `npm install -D esbuild`.

**RDS won't stop**: RDS auto-restarts after 7 days. This is an AWS limitation. For prod between events, be aware of this behavior.

**SSH connection refused**: Verify your `allowedSshCidr` in `cdk.context.json` matches your current public IP. You can check at https://checkip.amazonaws.com.
