import type { UsageProfile } from './usage-profile.js';
export interface ProfileNode {
  key: string; label: string; value: bigint; observationIds: string[]; children: Map<string, ProfileNode>;
}
/** Prefix identity keeps identically named tasks and operations distinct. */
export function profileTree(profile: UsageProfile): ProfileNode {
  const root: ProfileNode = { key: '[]', label: 'All recorded work', value: 0n, observationIds: [], children: new Map() };
  for (const sample of profile.samples) {
    const amount = BigInt(sample.integer_value);
    if (amount === 0n) continue;
    root.value += amount;
    let node = root;
    const path: string[] = [];
    for (const frame of sample.stack.slice(1)) {
      path.push(frame.id);
      let child = node.children.get(frame.id);
      if (!child) {
        child = { key: JSON.stringify(path), label: frame.label, value: 0n, observationIds: [], children: new Map() };
        node.children.set(frame.id, child);
      }
      child.value += amount;
      node = child;
    }
    node.observationIds.push(sample.observation_id);
  }
  return root;
}
export function findProfileNode(root: ProfileNode, key: string): ProfileNode | null {
  const pending = [root];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.key === key) return node;
    pending.push(...node.children.values());
  }
  return null;
}
export interface ProfileBar { node: ProfileNode; depth: number; left: number; width: number }
/** Only drawing coordinates become numbers; totals and layout sums stay exact. */
export function profileBars(root: ProfileNode): ProfileBar[] {
  if (root.value === 0n) return [];
  const percent = (value: bigint) => Number(value * 1_000_000n / root.value) / 10_000;
  const pending = [{ node: root, depth: 0, offset: 0n }];
  const bars: ProfileBar[] = [];
  while (pending.length) {
    const { node, depth, offset } = pending.pop()!;
    const width = percent(node.value);
    if (width < 0.3 || depth >= 12) continue;
    bars.push({ node, depth, left: percent(offset), width });
    let childOffset = offset;
    for (const child of [...node.children.values()].sort((a, b) => a.key.localeCompare(b.key))) {
      pending.push({ node: child, depth: depth + 1, offset: childOffset });
      childOffset += child.value;
    }
  }
  return bars;
}
