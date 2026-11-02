// Whether a pid names a live process, one test for every caller: EPERM (another user's process) counts as alive; 0 or a negative pid, which process.kill reads as a process group, never does.
export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    return process.kill(pid, 0);
  } catch (e) {
    return e.code === 'EPERM';
  }
}
