#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { BallotTrackStack } from '../lib/ballottrack-stack';
import { BallotTrackSharedStack } from '../lib/shared-stack';

const app = new cdk.App();

// ---------------------------------------------------------------------------
// Context variables — populated via cdk.context.json (gitignored)
// ---------------------------------------------------------------------------
const envName = app.node.tryGetContext('env') as string | undefined;
const awsAccountId = app.node.tryGetContext('awsAccountId') as string;
const awsRegion = app.node.tryGetContext('awsRegion') as string;
const allowedSshCidr = app.node.tryGetContext('allowedSshCidr') as string;
const domainName = app.node.tryGetContext('domainName') as string;
const githubRepo = app.node.tryGetContext('githubRepo') as string;
const devStartApiKey = app.node.tryGetContext('devStartApiKey') as string;

// ---------------------------------------------------------------------------
// Only create stacks when an env is specified (allows `cdk bootstrap` to work)
// ---------------------------------------------------------------------------
if (envName && ['dev', 'prod'].includes(envName)) {
  // Validate required context
  const required: Record<string, string | undefined> = {
    awsAccountId,
    awsRegion,
    allowedSshCidr,
    domainName,
    githubRepo,
  };
  for (const [key, value] of Object.entries(required)) {
    if (!value) {
      throw new Error(
        `Missing required context variable: ${key}. Add it to cdk.context.json (see cdk.context.example.json).`,
      );
    }
  }
  if (envName === 'dev' && !devStartApiKey) {
    throw new Error(
      'devStartApiKey is required for the dev environment. Add it to cdk.context.json.',
    );
  }

  const cdkEnv: cdk.Environment = { account: awsAccountId, region: awsRegion };

  // ----- Shared stack: Route 53 hosted zone + GitHub Actions OIDC -----
  const shared = new BallotTrackSharedStack(app, 'BallotTrack-shared', {
    env: cdkEnv,
    domainName,
    githubRepo,
    awsAccountId,
    awsRegion,
  });
  cdk.Tags.of(shared).add('Project', 'BallotTrack');

  // ----- Environment-specific stack -----
  const envStack = new BallotTrackStack(app, `BallotTrack-${envName}`, {
    env: cdkEnv,
    envName: envName as 'dev' | 'prod',
    domainName,
    allowedSshCidr,
    devStartApiKey: devStartApiKey || '',
    hostedZone: shared.hostedZone,
    awsAccountId,
    awsRegion,
  });
  cdk.Tags.of(envStack).add('Project', 'BallotTrack');
  cdk.Tags.of(envStack).add('Environment', envName);
}
