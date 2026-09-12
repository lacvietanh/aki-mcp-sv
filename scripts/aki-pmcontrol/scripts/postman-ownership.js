function eligibleTargets(targets, isEligible) {
  return targets
    .filter((target) => target && target.type === 'page' && isEligible(target.url))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function attachmentTargets(targets, isEligible) {
  return eligibleTargets(targets, isEligible);
}

function deterministicOwnerTargetId(targets, isEligible) {
  return eligibleTargets(targets, isEligible)[0]?.id || null;
}

function createdTarget(beforeIds, targets, isEligible) {
  const created = eligibleTargets(targets, isEligible).filter((target) => !beforeIds.has(target.id));
  return created.length === 1 ? created[0] : null;
}

async function waitForTargets({ listTargets, select, timeoutMs = 5000, pollMs = 100, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  const deadline = Date.now() + timeoutMs;
  do {
    const selected = select(await listTargets());
    if (selected) return selected;
    await sleep(pollMs);
  } while (Date.now() < deadline);
  return null;
}

function waitForEligibleTargets({ listTargets, isEligible, ...options }) {
  return waitForTargets({ ...options, listTargets, select: (targets) => {
    const eligible = eligibleTargets(targets, isEligible);
    return eligible.length ? eligible : null;
  } });
}

function waitForCreatedTarget({ beforeIds, listTargets, isEligible, ...options }) {
  return waitForTargets({ ...options, listTargets, select: (targets) => createdTarget(beforeIds, targets, isEligible) });
}

async function openOwnedWindow({ ownerClient, listTargets, isEligible, ...options }) {
  const beforeIds = new Set((await listTargets()).map((target) => target.id));
  await ownerClient.Runtime.evaluate({ expression: "window.pm && window.pm.mediator.trigger('newRequesterWindow')" });
  return waitForCreatedTarget({ ...options, beforeIds, listTargets, isEligible });
}

module.exports = { eligibleTargets, attachmentTargets, deterministicOwnerTargetId, createdTarget, waitForEligibleTargets, waitForCreatedTarget, openOwnedWindow };
