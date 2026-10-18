import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { NetworkRequest, DashboardStats, Packet, TopologyNode } from '../types/network';
import { closeCapture, loadRecording, nextPacketId, startCapture, stopCapture, resumeCapture } from '../services/realTraffic';
import { detectTechStack, getHostname, getNodeTypeFromTech } from '../utils/techDetection';

const MAX_REQUESTS = 500;
const CLIENT_NODE: TopologyNode = { id: 'client', label: 'JMeter', x: 0.07, y: 0.5, type: 'client', color: '#3b82f6', requestCount: 0 };

function buildTopologyNodes(requests: NetworkRequest[]): TopologyNode[] {
  const hosts = new Map<string, { count: number; tech: ReturnType<typeof detectTechStack> }>();
  requests.forEach(req => { const found = hosts.get(req.hostname); if (found) found.count++; else hosts.set(req.hostname, { count: 1, tech: req.techStack ?? detectTechStack(req.url) }); });
  const stepOrder = (host: string) => host.startsWith('auth.') ? 1 : host.startsWith('catalog.') ? 2 : host.startsWith('order.') ? 3 : 99;
  const stepLabel = (host: string) => host.startsWith('auth.') ? '1. 인증' : host.startsWith('catalog.') ? '2. 상품 조회' : host.startsWith('order.') ? '3. 주문' : host;
  const ordered = [...hosts.entries()].sort((a, b) => stepOrder(a[0]) - stepOrder(b[0]) || b[1].count - a[1].count);
  return [CLIENT_NODE, ...ordered.map(([host, data], index) => ({
    id: `host-${host}`, label: stepLabel(host), x: Math.min(0.9, 0.32 + index * 0.25), y: 0.5,
    type: getNodeTypeFromTech(data.tech), color: data.tech.color, techStack: data.tech, requestCount: data.count,
  }))].map(node => node.id === 'client' ? { ...node, requestCount: requests.length } : node);
}

export function useNetworkCapture() {
  const [requests, setRequests] = useState<NetworkRequest[]>([]);
  const [recording, setRecording] = useState<NetworkRequest[]>([]);
  const [packets, setPackets] = useState<Packet[]>([]);
  const [isCapturing, setIsCapturing] = useState(true);
  const [isReplaying, setIsReplaying] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<NetworkRequest | null>(null);
  const [domainFilter, setDomainFilter] = useState<string | null>(null);
  const [collectorConnected, setCollectorConnected] = useState(false);
  const seen = useRef(new Set<string>());
  const replayTimer = useRef<number | null>(null);

  const addRequest = useCallback((request: NetworkRequest) => {
    if (seen.current.has(request.id)) return;
    seen.current.add(request.id);
    const hydrated = { ...request, hostname: request.hostname || getHostname(request.url), techStack: request.techStack ?? detectTechStack(request.url) };
    setRequests(previous => [hydrated, ...previous].slice(0, MAX_REQUESTS));
    const targetNodeId = `host-${hydrated.hostname}`;
    const sourceNodeId = hydrated.flow?.previousStepId ? `host-${hydrated.flow.previousStepId}.${hydrated.flow.name}.local` : 'client';
    setPackets(previous => [...previous, { id: nextPacketId(), requestId: hydrated.id, method: hydrated.method, status: 'pending', progress: 0, isResponse: false, targetNodeId, sourceNodeId }]);
    window.setTimeout(() => setPackets(previous => [...previous, { id: nextPacketId(), requestId: hydrated.id, method: hydrated.method, status: hydrated.status, progress: 0, isResponse: true, targetNodeId, sourceNodeId }]), Math.min(Math.max(hydrated.timing.duration * 0.4, 100), 1200));
  }, []);

  const refreshRecording = useCallback(async () => { const loaded = await loadRecording(); setRecording(loaded); return loaded; }, []);

  useEffect(() => {
    let alive = true;
    refreshRecording().then(loaded => { if (alive) loaded.forEach(addRequest); }).catch(() => setCollectorConnected(false));
    startCapture((request) => {
      setRecording(previous => previous.some(item => item.id === request.id) ? previous : [...previous, request]);
      addRequest(request);
    }, setCollectorConnected);
    return () => { alive = false; closeCapture(); if (replayTimer.current) window.clearTimeout(replayTimer.current); };
  }, [addRequest, refreshRecording]);

  useEffect(() => { isCapturing ? resumeCapture(addRequest) : stopCapture(); }, [isCapturing, addRequest]);
  useEffect(() => {
    let last = performance.now(); let frame = 0;
    const animate = (now: number) => { const speed = (now - last) * 0.0008; last = now; setPackets(current => current.map(packet => ({ ...packet, progress: packet.progress + speed })).filter(packet => packet.progress <= 1)); frame = requestAnimationFrame(animate); };
    frame = requestAnimationFrame(animate); return () => cancelAnimationFrame(frame);
  }, []);

  const replay = useCallback(async (speed: number) => {
    const events = await refreshRecording(); if (!events.length) return;
    if (replayTimer.current) window.clearTimeout(replayTimer.current);
    setIsReplaying(true); setRequests([]); setPackets([]); seen.current.clear(); let index = 0;
    const step = () => {
      if (index >= events.length) { setIsReplaying(false); return; }
      addRequest(events[index]); const previous = events[index++]; const next = events[index];
      replayTimer.current = window.setTimeout(step, next ? Math.max(40, Math.min(2000, (next.timestamp - previous.timestamp) / speed)) : 120);
    }; step();
  }, [addRequest, refreshRecording]);

  const availableDomains = useMemo(() => [...new Set(requests.map(request => request.tabDomain || request.hostname))], [requests]);
  const filteredRequests = useMemo(() => domainFilter ? requests.filter(request => (request.tabDomain || request.hostname) === domainFilter) : requests, [requests, domainFilter]);
  const allowed = useMemo(() => new Set(filteredRequests.map(request => request.id)), [filteredRequests]);
  const filteredPackets = useMemo(() => packets.filter(packet => allowed.has(packet.requestId)), [packets, allowed]);
  const topologyNodes = useMemo(() => buildTopologyNodes(filteredRequests), [filteredRequests]);
  const stats: DashboardStats = useMemo(() => ({
    totalRequests: filteredRequests.length, successCount: filteredRequests.filter(request => request.status === 'success').length, errorCount: filteredRequests.filter(request => request.status === 'error').length,
    avgResponseTime: filteredRequests.length ? filteredRequests.reduce((sum, request) => sum + request.timing.duration, 0) / filteredRequests.length : 0,
    totalBytes: filteredRequests.reduce((sum, request) => sum + request.size, 0),
    requestsPerSecond: filteredRequests.length > 1 ? filteredRequests.length / Math.max(1, (Date.now() - filteredRequests[filteredRequests.length - 1].timestamp) / 1000) : 0,
  }), [filteredRequests]);
  const clearRequests = useCallback(() => { setRequests([]); setPackets([]); setSelectedRequest(null); seen.current.clear(); }, []);
  return { requests: filteredRequests, packets: filteredPackets, stats, isCapturing, isReplaying, recordingCount: recording.length, selectedRequest, topologyNodes, domainFilter, availableDomains, extensionConnected: collectorConnected, setIsCapturing, setSelectedRequest, setDomainFilter, clearRequests, replay };
}
