#!/usr/bin/env bash
# Update the BallotTrack EC2 security groups to allow SSH from your current IP.
# Usage: ./update-ssh-ip.sh [dev|prod|both]
#
# Requires: aws cli configured, jq, curl

set -euo pipefail

ENV="${1:-both}"
REGION="us-west-2"
NEW_IP=$(curl -s https://checkip.amazonaws.com)
NEW_CIDR="${NEW_IP}/32"

echo "Your current public IP: ${NEW_IP}"

update_sg() {
  local sg_name="$1"
  local sg_id

  sg_id=$(aws ec2 describe-security-groups \
    --region "$REGION" \
    --filters "Name=group-name,Values=${sg_name}" \
    --query "SecurityGroups[0].GroupId" \
    --output text)

  if [ "$sg_id" = "None" ] || [ -z "$sg_id" ]; then
    echo "  Security group '${sg_name}' not found — skipping"
    return
  fi

  # Remove existing SSH rules (port 22)
  local old_cidrs
  old_cidrs=$(aws ec2 describe-security-groups \
    --region "$REGION" \
    --group-ids "$sg_id" \
    --query "SecurityGroups[0].IpPermissions[?FromPort==\`22\`].IpRanges[].CidrIp" \
    --output text)

  for old_cidr in $old_cidrs; do
    echo "  Removing old SSH rule: ${old_cidr} from ${sg_name}"
    aws ec2 revoke-security-group-ingress \
      --region "$REGION" \
      --group-id "$sg_id" \
      --protocol tcp --port 22 \
      --cidr "$old_cidr" > /dev/null
  done

  # Add new SSH rule
  echo "  Adding SSH rule: ${NEW_CIDR} to ${sg_name} (${sg_id})"
  aws ec2 authorize-security-group-ingress \
    --region "$REGION" \
    --group-id "$sg_id" \
    --protocol tcp --port 22 \
    --cidr "$NEW_CIDR" > /dev/null

  echo "  Done: ${sg_name}"
}

case "$ENV" in
  dev)
    update_sg "ballottrack-dev-ec2"
    ;;
  prod)
    update_sg "ballottrack-prod-ec2"
    ;;
  both)
    update_sg "ballottrack-dev-ec2"
    update_sg "ballottrack-prod-ec2"
    ;;
  *)
    echo "Usage: $0 [dev|prod|both]"
    exit 1
    ;;
esac

echo ""
echo "SSH access updated to ${NEW_CIDR}"

# Also update cdk.context.json so future deploys don't revert the change
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONTEXT_FILE="${SCRIPT_DIR}/cdk.context.json"
if [ -f "$CONTEXT_FILE" ] && command -v jq &> /dev/null; then
  jq --arg cidr "$NEW_CIDR" '.allowedSshCidr = $cidr' "$CONTEXT_FILE" > "${CONTEXT_FILE}.tmp"
  mv "${CONTEXT_FILE}.tmp" "$CONTEXT_FILE"
  echo "Updated cdk.context.json with new IP"
fi
