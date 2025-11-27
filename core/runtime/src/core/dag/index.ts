export type NodeId = string;

export interface DagNode {
  id: NodeId;
  kind: "expr" | "query" | "rule" | "constraint" | "view";
  reads: string[]; // derived dependencies
  writes: string[]; // produced ids/preds
}

export interface Dag {
  nodes: Map<NodeId, DagNode>;
  edges: Map<NodeId, Set<NodeId>>; // from -> to (read -> write)
}

export interface TopoLayer {
  nodes: DagNode[];
  fixpoint?: boolean;
}

export interface TopoOrder {
  layers: TopoLayer[];
}

export function buildDag(nodes: DagNode[]): Dag {
  const dag: Dag = { nodes: new Map(), edges: new Map() };
  for (const n of nodes) {
    dag.nodes.set(n.id, n);
    dag.edges.set(n.id, new Set());
  }
  // naive dependency edges: if A.reads intersects B.writes, then A depends on B
  for (const a of nodes) {
    for (const b of nodes) {
      if (a.id === b.id) continue;
      if (a.reads.some((r) => b.writes.includes(r))) {
        dag.edges.get(b.id)!.add(a.id);
      }
    }
  }
  return dag;
}

export function topoSort(dag: Dag, _opts?: { allowFixpoint?: boolean }): TopoOrder {
  // Kahn's algorithm (simplified). No cycle handling in MVP.
  const inDegree = new Map<NodeId, number>();
  for (const id of dag.nodes.keys()) inDegree.set(id, 0);
  for (const [, outs] of dag.edges) for (const v of outs) inDegree.set(v, (inDegree.get(v) ?? 0) + 1);

  const q: DagNode[] = [];
  for (const [id, deg] of inDegree) if (deg === 0) q.push(dag.nodes.get(id)!);

  const layers: TopoLayer[] = [];
  const visited = new Set<NodeId>();
  while (q.length) {
    const layerNodes = q.splice(0, q.length);
    for (const n of layerNodes) visited.add(n.id);
    layers.push({ nodes: layerNodes });
    for (const n of layerNodes) {
      for (const v of dag.edges.get(n.id) ?? []) {
        inDegree.set(v, (inDegree.get(v) ?? 0) - 1);
        if ((inDegree.get(v) ?? 0) === 0) q.push(dag.nodes.get(v)!);
      }
    }
  }

  // If cycles exist, put remaining nodes in a final fixpoint layer
  const remaining = [...dag.nodes.keys()].filter((id) => !visited.has(id));
  if (remaining.length) {
    layers.push({ nodes: remaining.map((id) => dag.nodes.get(id)!), fixpoint: true });
  }

  return { layers };
}

