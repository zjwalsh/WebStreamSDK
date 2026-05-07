import React, { useEffect, useState, useRef } from 'react';
import { Desktop } from "@wxcc-desktop/sdk";
import Webex from "webex";
import './App.css';

const CONTACT_EVENTS = [
  'eAgentContact',
  'eAgentContactAssigned',
  'eAgentOfferContact',
  'eAgentContactEnded'
];

const collectInteractionId = (value) => {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const interactionId = collectInteractionId(item);
      if (interactionId) {
        return interactionId;
      }
    }
    return null;
  }

  if (typeof value !== 'object') {
    return null;
  }

  const directKeys = ['interactionId', 'interactionID', 'taskId'];
  for (const key of directKeys) {
    if (typeof value[key] === 'string' && value[key]) {
      return value[key];
    }
  }

  const nestedKeys = ['data', 'task', 'contact', 'payload', 'detail'];
  for (const key of nestedKeys) {
    const interactionId = collectInteractionId(value[key]);
    if (interactionId) {
      return interactionId;
    }
  }

  return null;
};

const normalizeInteractionId = (value) => {
  if (value == null) {
    return null;
  }

  const normalized = typeof value === 'string' ? value.trim() : value;

  if (
    normalized === '' ||
    normalized === 'null' ||
    normalized === 'undefined' ||
    (typeof normalized === 'string' && normalized.startsWith('$STORE.'))
  ) {
    return null;
  }

  return normalized;
};

const extractInteractionIdFromTaskMap = (taskMap) => {
  if (!taskMap) {
    return null;
  }

  const tasks = Array.isArray(taskMap)
    ? taskMap
    : Object.values(taskMap.tasks || taskMap).filter(Boolean);

  for (const task of tasks) {
    const interactionId = collectInteractionId(task);
    if (interactionId) {
      return interactionId;
    }
  }

  return null;
};

const getStoreState = () => {
  const store = window.$Store;

  if (!store || typeof store.getState !== 'function') {
    return null;
  }

  try {
    return store.getState();
  } catch (err) {
    console.warn('[Signature] window.$Store.getState failed', err);
    return null;
  }
};

const extractInteractionIdFromStore = (state) => {
  if (!state || typeof state !== 'object') {
    return null;
  }

  return (
    state.agentContact?.taskSelected?.interactionId ||
    extractInteractionIdFromTaskMap(state.taskMap) ||
    null
  );
};

const resolveDesktopSdk = () => window.WxccDesktopSDK?.Desktop || Desktop;

const getObjectValues = (value) => {
  if (!value || typeof value !== 'object') {
    return [];
  }

  try {
    return Object.values(value);
  } catch {
    return [];
  }
};

const HOST_TASK_SEARCH_LIMIT = 250;

const getObjectEntries = (value) => {
  if (!value || typeof value !== 'object') {
    return [];
  }

  try {
    return Object.entries(value);
  } catch {
    return [];
  }
};

const collectAudioStreams = (value, seen = new WeakSet(), depth = 0) => {
  if (!value || depth > 3) {
    return [];
  }

  if (typeof MediaStream !== 'undefined' && value instanceof MediaStream) {
    return value.getAudioTracks().length ? [value] : [];
  }

  if (typeof MediaStreamTrack !== 'undefined' && value instanceof MediaStreamTrack) {
    if (value.kind !== 'audio') {
      return [];
    }

    const stream = new MediaStream();
    stream.addTrack(value);
    return [stream];
  }

  if (typeof value !== 'object') {
    return [];
  }

  if (seen.has(value)) {
    return [];
  }

  seen.add(value);

  const streams = [];
  for (const item of getObjectValues(value)) {
    streams.push(...collectAudioStreams(item, seen, depth + 1));
  }

  return streams;
};

const dedupeAudioStreams = (streams) => {
  const unique = [];
  const keys = new Set();

  for (const stream of streams) {
    const trackIds = stream.getAudioTracks().map((track) => track.id).sort().join('|');
    const key = trackIds || `stream-${unique.length}`;

    if (!keys.has(key)) {
      keys.add(key);
      unique.push(stream);
    }
  }

  return unique;
};

const isMatchingTaskCandidate = (value, interactionId) => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidateInteractionId = normalizeInteractionId(
    value?.data?.interactionId || value?.interactionId || collectInteractionId(value)
  );

  if (!candidateInteractionId || candidateInteractionId !== interactionId) {
    return false;
  }

  return (
    typeof value.on === 'function' ||
    typeof value.addEventListener === 'function' ||
    typeof value.accept === 'function'
  );
};

const findTaskCandidateInValue = (value, interactionId, path, seen, budget, depth = 0) => {
  if (!value || typeof value !== 'object' || depth > 4 || budget.count > HOST_TASK_SEARCH_LIMIT) {
    return null;
  }

  if (seen.has(value)) {
    return null;
  }

  seen.add(value);
  budget.count += 1;

  if (isMatchingTaskCandidate(value, interactionId)) {
    return { task: value, path };
  }

  for (const [key, child] of getObjectEntries(value)) {
    if (
      child == null ||
      typeof child !== 'object' ||
      key === 'window' ||
      key === 'document' ||
      key === 'parent' ||
      key === 'top'
    ) {
      continue;
    }

    const result = findTaskCandidateInValue(
      child,
      interactionId,
      `${path}.${key}`,
      seen,
      budget,
      depth + 1
    );

    if (result) {
      return result;
    }
  }

  return null;
};

const findHostTaskForInteraction = (interactionId) => {
  if (!interactionId) {
    return { task: null, summary: 'inactive' };
  }

  const roots = [
    ['window.wxcc', window.wxcc],
    ['window.wxcc.cc', window.wxcc?.cc],
    ['window.wxcc.agentContact', window.wxcc?.agentContact],
    ['window.AGENTX_SERVICE', window.AGENTX_SERVICE],
    ['window.AGENTX_SERVICE.SERVICE', window.AGENTX_SERVICE?.SERVICE],
    ['window.AGENTX_SERVICE.cc', window.AGENTX_SERVICE?.cc],
    ['window.AGENTX_SERVICE.SERVICE.cc', window.AGENTX_SERVICE?.SERVICE?.cc],
    ['window.AGENTX_SERVICE.webex', window.AGENTX_SERVICE?.webex],
    ['window.AGENTX_SERVICE.SERVICE.webex', window.AGENTX_SERVICE?.SERVICE?.webex],
    ['window.AGENTX_SERVICE.agentContact', window.AGENTX_SERVICE?.agentContact],
    ['window.WxccDesktopSDK', window.WxccDesktopSDK]
  ];

  const seen = new WeakSet();
  const budget = { count: 0 };

  for (const [label, root] of roots) {
    const result = findTaskCandidateInValue(root, interactionId, label, seen, budget);
    if (result) {
      return { task: result.task, summary: result.path };
    }
  }

  const availableRoots = roots
    .filter(([, root]) => Boolean(root))
    .map(([label]) => label)
    .join(' | ');

  return {
    task: null,
    summary: availableRoots ? `searched ${availableRoots}` : 'no host roots'
  };
};

const summarizeMeeting = (meeting) => {
  if (!meeting) {
    return 'none';
  }

  return [meeting.id, meeting.correlationId].filter(Boolean).join(' / ') || 'unknown meeting';
};

const summarizeCall = (call) => {
  if (!call) {
    return 'none';
  }

  const correlationId = typeof call.getCorrelationId === 'function' ? call.getCorrelationId() : null;
  const callId = typeof call.getCallId === 'function' ? call.getCallId() : null;
  return [correlationId, callId].filter(Boolean).join(' / ') || 'unknown call';
};

const findMeetingForInteraction = (webex, interactionId) => {
  const meetings = getObjectValues(webex?.meetings?.getAllMeetings?.());
  const meeting = meetings.find((candidate) => {
    const id = candidate?.id || '';
    const correlationId = candidate?.correlationId || '';
    return id.includes(interactionId) || correlationId === interactionId;
  });

  return {
    meeting,
    summary: meetings.map(summarizeMeeting).join(' | ') || 'none'
  };
};

const findCallingCallForInteraction = (webex, interactionId) => {
  const activeCallsByLine = webex?.calling?.callingClient?.getActiveCalls?.() || {};
  const activeCalls = Object.values(activeCallsByLine).flat();
  const connectedCall = webex?.calling?.callingClient?.getConnectedCall?.();
  const call = activeCalls.find((candidate) => {
    const correlationId = typeof candidate?.getCorrelationId === 'function' ? candidate.getCorrelationId() : '';
    const callId = typeof candidate?.getCallId === 'function' ? candidate.getCallId() : '';
    return correlationId === interactionId || callId === interactionId;
  }) || connectedCall;

  return {
    call,
    summary: activeCalls.map(summarizeCall).join(' | ') || 'none'
  };
};

const streamFromTrack = (track) => {
  if (!track || track.kind !== 'audio') {
    return null;
  }

  return new MediaStream([track]);
};

const getLocalStreamFromCall = (call) => {
  const outputStream = call?.localAudioStream?.outputStream;

  if (outputStream instanceof MediaStream && outputStream.getAudioTracks().length) {
    return outputStream;
  }

  return null;
};

const getRemoteStreamFromCall = (call, remoteTrack) => {
  if (remoteTrack) {
    return streamFromTrack(remoteTrack);
  }

  const mediaConnection = call?.mediaConnection;
  if (!mediaConnection || typeof mediaConnection !== 'object') {
    return null;
  }

  const directTracks = [
    mediaConnection.remoteAudioTrack,
    mediaConnection.remoteTrack,
    mediaConnection.audioTrack
  ].filter(Boolean);

  for (const track of directTracks) {
    const stream = streamFromTrack(track);
    if (stream) {
      return stream;
    }
  }

  const peerConnections = [
    mediaConnection.peerConnection,
    mediaConnection._peerConnection,
    mediaConnection.pc,
    mediaConnection.rtcPeerConnection
  ].filter(Boolean);

  for (const peerConnection of peerConnections) {
    const receiverTracks = (peerConnection.getReceivers?.() || [])
      .map((receiver) => receiver?.track)
      .filter((track) => track?.kind === 'audio');

    if (receiverTracks.length) {
      return new MediaStream(receiverTracks);
    }
  }

  return null;
};

const getStreamsFromHostTask = (task, remoteTrack) => {
  if (!task) {
    return [];
  }

  return dedupeAudioStreams(
    [
      streamFromTrack(remoteTrack),
      task?.localAudioStream?.outputStream,
      ...collectAudioStreams(task)
    ].filter(Boolean)
  );
};

const getHostWebCallingService = () => {
  const candidates = [
    ['window.AGENTX_SERVICE.SERVICE.webCalling', window.AGENTX_SERVICE?.SERVICE?.webCalling],
    ['window.AGENTX_SERVICE.webCalling', window.AGENTX_SERVICE?.webCalling],
    ['window.wxcc.cc.webCalling', window.wxcc?.cc?.webCalling],
    ['window.wxcc.webCalling', window.wxcc?.webCalling]
  ];

  for (const [label, service] of candidates) {
    if (service) {
      return { label, service, candidates };
    }
  }

  return { label: 'none', service: null, candidates };
};

const flattenActiveCalls = (activeCallsByLine) => {
  if (!activeCallsByLine || typeof activeCallsByLine !== 'object') {
    return [];
  }

  return Object.values(activeCallsByLine).flat().filter(Boolean);
};

const getCallKey = (call) => {
  if (!call) {
    return null;
  }

  const callId = typeof call.getCallId === 'function' ? call.getCallId() : call.callId;
  const correlationId = typeof call.getCorrelationId === 'function'
    ? call.getCorrelationId()
    : call.correlationId;

  return normalizeInteractionId(callId || correlationId);
};

const getMappedCallIdForInteraction = (callTaskMap, interactionId) => {
  if (!callTaskMap || !interactionId) {
    return null;
  }

  const entries = callTaskMap instanceof Map
    ? Array.from(callTaskMap.entries())
    : Object.entries(callTaskMap);

  for (const [callId, taskId] of entries) {
    if (normalizeInteractionId(taskId) === interactionId) {
      return normalizeInteractionId(callId);
    }
  }

  return null;
};

const findHostWebCallingForInteraction = (interactionId) => {
  const { label, service, candidates } = getHostWebCallingService();

  if (!service) {
    return {
      service: null,
      call: null,
      summary: candidates
        .filter(([, candidate]) => Boolean(candidate))
        .map(([candidateLabel]) => candidateLabel)
        .join(' | ') || 'none'
    };
  }

  const serviceCandidates = [
    { label, service },
    ...candidates
      .filter(([candidateLabel, candidateService]) => candidateService && candidateLabel !== label)
      .map(([candidateLabel, candidateService]) => ({ label: candidateLabel, service: candidateService }))
  ];

  let bestMatch = null;

  for (const candidate of serviceCandidates) {
    const activeCalls = flattenActiveCalls(
      candidate.service.getActiveCalls?.() || candidate.service.callingClient?.getActiveCalls?.()
    );
    const connectedCall = candidate.service.getConnectedCall?.()
      || candidate.service.callingClient?.getConnectedCall?.();
    const mappedCallId = getMappedCallIdForInteraction(candidate.service.callTaskMap, interactionId);
    const call = activeCalls.find((activeCall) => {
      const callKey = getCallKey(activeCall);
      return callKey === interactionId || (mappedCallId && callKey === mappedCallId);
    }) || candidate.service.call || connectedCall || null;

    const score = [mappedCallId, activeCalls.length, candidate.service.call ? 1 : 0]
      .filter(Boolean)
      .length;

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = {
        ...candidate,
        score,
        activeCalls,
        connectedCall,
        mappedCallId,
        call
      };
    }

    if (mappedCallId || activeCalls.length || candidate.service.call) {
      break;
    }
  }

  const matchedService = bestMatch?.service || service;
  const matchedLabel = bestMatch?.label || label;
  const activeCalls = bestMatch?.activeCalls || [];
  const mappedCallId = bestMatch?.mappedCallId || null;
  const call = bestMatch?.call || null;
  const keyList = Object.keys(matchedService).sort().slice(0, 10).join(',') || 'no-keys';
  const agentxKeyList = Object.keys(window.AGENTX_SERVICE || {}).sort().slice(0, 10).join(',') || 'no-agentx-keys';
  const callSummary = activeCalls.map(summarizeCall).join(' | ') || 'none';
  const mappingSummary = mappedCallId ? `mapped:${mappedCallId}` : 'mapped:none';
  const serviceFlags = [
    typeof matchedService.on === 'function' ? 'on' : null,
    typeof matchedService.off === 'function' ? 'off' : null,
    matchedService.call ? 'call' : null,
    matchedService.callingClient ? 'callingClient' : null,
    matchedService.callTaskMap ? 'callTaskMap' : null
  ].filter(Boolean).join(',') || 'no-flags';
  const mapSize = matchedService.callTaskMap instanceof Map
    ? matchedService.callTaskMap.size
    : Object.keys(matchedService.callTaskMap || {}).length;

  return {
    service: matchedService,
    call,
    summary: `${matchedLabel}; ${mappingSummary}; map:${mapSize}; agentx:${agentxKeyList}; keys:${keyList}; flags:${serviceFlags}; calls:${callSummary}`
  };
};

const App = ({ interactionId: widgetInteractionId = null }) => {
  const [desktopInteractionId, setDesktopInteractionId] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [lastEvent, setLastEvent] = useState('none');
  const [taskMapInteractionId, setTaskMapInteractionId] = useState(null);
  const [storeInteractionId, setStoreInteractionId] = useState(null);
  const [hasStoreBridge, setHasStoreBridge] = useState(false);
  const [hasAgentService, setHasAgentService] = useState(false);
  const [hasGlobalSdk, setHasGlobalSdk] = useState(false);
  const [isFramed, setIsFramed] = useState(false);
  const [mediaSurface, setMediaSurface] = useState('none');
  const [meetingSummary, setMeetingSummary] = useState('none');
  const [callingSummary, setCallingSummary] = useState('none');
  const [hostTaskSummary, setHostTaskSummary] = useState('none');
  const [hostWebCallingSummary, setHostWebCallingSummary] = useState('none');
  const prevIdRef = useRef(null);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const audioCtxRef = useRef(null);
  const mixedDestRef = useRef(null);
  const webexRef = useRef(null);
  const activeCallRef = useRef(null);
  const activeTaskRef = useRef(null);
  const activeHostWebCallingRef = useRef(null);
  const remoteTrackRef = useRef(null);
  const activeCallListenerRef = useRef(null);
  const activeTaskListenerRef = useRef(null);
  const activeHostWebCallingListenerRef = useRef(null);
  const resolvedWidgetInteractionId = normalizeInteractionId(widgetInteractionId);
  const interactionId = resolvedWidgetInteractionId ?? storeInteractionId ?? desktopInteractionId;

  useEffect(() => {
    setIsFramed(window.self !== window.top);
    setHasAgentService(Boolean(window.AGENTX_SERVICE));
    setHasStoreBridge(Boolean(window.$Store?.getState));
    setHasGlobalSdk(Boolean(window.WxccDesktopSDK?.Desktop));
  }, []);

  useEffect(() => {
    let isMounted = true;
    let unsubscribeStore;
    const desktopSdk = resolveDesktopSdk();

    const initializeDesktop = async () => {
      const initialStoreState = getStoreState();
      const initialStoreInteractionId = extractInteractionIdFromStore(initialStoreState);

      if (isMounted && initialStoreInteractionId) {
        console.log('[Signature] store interaction:', initialStoreInteractionId);
        setStoreInteractionId(initialStoreInteractionId);
        setLastEvent('store-snapshot');
      }

      try {
        desktopSdk.config.init({
          widgetName: 'wxcc-signature-widget',
          widgetProvider: 'Amplify'
        });
      } catch (err) {
        console.warn('[Signature] Desktop.config.init failed', err);
      }

      try {
        const taskMap = await desktopSdk.actions.getTaskMap();
        const currentInteractionId = extractInteractionIdFromTaskMap(taskMap);
        if (isMounted) {
          setTaskMapInteractionId(currentInteractionId);
        }
        if (isMounted && currentInteractionId) {
          console.log('[Signature] task map interaction:', currentInteractionId);
          setDesktopInteractionId(currentInteractionId);
          setLastEvent('task-map');
        }
      } catch (err) {
        console.warn('[Signature] Desktop.actions.getTaskMap failed', err);
      }

      try {
        const token = await desktopSdk.actions.getToken();
        webexRef.current = Webex.init({
          config: { meetings: { deviceType: 'WEB' } },
          credentials: { access_token: token || 'REPLACE_WITH_AGENT_OAUTH_TOKEN' }
        });
      } catch (err) {
        console.warn('[Signature] Desktop.actions.getToken failed', err);
        webexRef.current = Webex.init({
          config: { meetings: { deviceType: 'WEB' } },
          credentials: { access_token: 'REPLACE_WITH_AGENT_OAUTH_TOKEN' }
        });
      }
    };

    const store = window.$Store;
    if (store?.subscribe) {
      unsubscribeStore = store.subscribe(() => {
        const nextStoreState = getStoreState();
        const nextStoreInteractionId = extractInteractionIdFromStore(nextStoreState);
        setHasStoreBridge(true);
        setStoreInteractionId(nextStoreInteractionId);

        if (nextStoreInteractionId) {
          setLastEvent('store-update');
        }
      });
    }

    const listeners = CONTACT_EVENTS.map((eventName) => {
      const listener = (message) => {
        const nextInteractionId = collectInteractionId(message);
        console.log(`[Signature] ${eventName}:`, message);
        setLastEvent(eventName);

        if (nextInteractionId) {
          setDesktopInteractionId(nextInteractionId);
        }

        if (eventName === 'eAgentContactEnded') {
          setDesktopInteractionId(null);
        }
      };

      try {
        desktopSdk.agentContact.addEventListener(eventName, listener);
      } catch (err) {
        console.warn(`[Signature] failed to subscribe to ${eventName}`, err);
      }

      return { eventName, listener };
    });

    const poll = window.setInterval(async () => {
      if (widgetInteractionId) {
        return;
      }

      const currentStoreState = getStoreState();
      const currentStoreInteractionId = extractInteractionIdFromStore(currentStoreState);
      setHasStoreBridge(Boolean(window.$Store?.getState));
      setHasAgentService(Boolean(window.AGENTX_SERVICE));
      setHasGlobalSdk(Boolean(window.WxccDesktopSDK?.Desktop));
      setStoreInteractionId(currentStoreInteractionId);

      try {
        const taskMap = await desktopSdk.actions.getTaskMap();
        const currentInteractionId = extractInteractionIdFromTaskMap(taskMap);
        setTaskMapInteractionId(currentInteractionId);
        setDesktopInteractionId(currentInteractionId);
      } catch (err) {
        try {
          const id = desktopSdk.agentContact.taskSelected?.interactionId || null;
          setDesktopInteractionId(id);
        } catch (fallbackError) {
          console.warn('[Signature] contact polling failed', fallbackError);
        }
      }
    }, 1000);

    initializeDesktop();

    return () => {
      isMounted = false;
      unsubscribeStore?.();
      window.clearInterval(poll);
      for (const { eventName, listener } of listeners) {
        try {
          desktopSdk.agentContact.removeEventListener(eventName, listener);
        } catch (err) {
          console.warn(`[Signature] failed to remove ${eventName}`, err);
        }
      }
    };
  }, [resolvedWidgetInteractionId]);

  useEffect(() => {
    if (interactionId && interactionId !== prevIdRef.current) {
      console.log("[Signature] call connected:", interactionId);
      setStatus("Call detected - ready to record");
      prepareAudioContext();
    } else if (!interactionId && prevIdRef.current) {
      console.log("[Signature] call ended");
      setStatus("Ready");
    }
    prevIdRef.current = interactionId;
  }, [interactionId]);

  const prepareAudioContext = () => {
    if (audioCtxRef.current) {
      return;
    }

    audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    mixedDestRef.current = audioCtxRef.current.createMediaStreamDestination();
  };

  const detachCallListener = () => {
    const activeCall = activeCallRef.current;
    const listener = activeCallListenerRef.current;

    if (!activeCall || !listener) {
      return;
    }

    if (typeof activeCall.off === 'function') {
      activeCall.off('remote_media', listener);
    } else if (typeof activeCall.removeListener === 'function') {
      activeCall.removeListener('remote_media', listener);
    }

    activeCallListenerRef.current = null;
  };

  const detachTaskListener = () => {
    const activeTask = activeTaskRef.current;
    const listener = activeTaskListenerRef.current;

    if (!activeTask || !listener) {
      return;
    }

    if (typeof activeTask.off === 'function') {
      activeTask.off('task:media', listener);
    } else if (typeof activeTask.removeListener === 'function') {
      activeTask.removeListener('task:media', listener);
    } else if (typeof activeTask.removeEventListener === 'function') {
      activeTask.removeEventListener('task:media', listener);
    }

    activeTaskListenerRef.current = null;
  };

  const detachHostWebCallingListener = () => {
    const service = activeHostWebCallingRef.current;
    const listener = activeHostWebCallingListenerRef.current;

    if (!service || !listener) {
      return;
    }

    if (typeof service.off === 'function') {
      service.off('remote_media', listener);
    } else if (typeof service.removeListener === 'function') {
      service.removeListener('remote_media', listener);
    }

    activeHostWebCallingListenerRef.current = null;
  };

  const attachCallListener = (call) => {
    if (!call || activeCallRef.current === call) {
      return;
    }

    detachCallListener();
    activeCallRef.current = call;
    remoteTrackRef.current = null;

    if (typeof call.on !== 'function') {
      return;
    }

    const listener = (track) => {
      console.log('[Signature] remote_media track received', track);
      remoteTrackRef.current = track;
    };

    call.on('remote_media', listener);
    activeCallListenerRef.current = listener;
  };

  const attachTaskListener = (task) => {
    if (!task || activeTaskRef.current === task) {
      return;
    }

    detachTaskListener();
    activeTaskRef.current = task;
    remoteTrackRef.current = null;

    const listener = (track) => {
      console.log('[Signature] task:media track received', track);
      remoteTrackRef.current = track;
    };

    if (typeof task.on === 'function') {
      task.on('task:media', listener);
      activeTaskListenerRef.current = listener;
      return;
    }

    if (typeof task.addEventListener === 'function') {
      task.addEventListener('task:media', listener);
      activeTaskListenerRef.current = listener;
    }
  };

  const attachHostWebCallingListener = (service) => {
    if (!service || activeHostWebCallingRef.current === service) {
      return;
    }

    detachHostWebCallingListener();
    activeHostWebCallingRef.current = service;

    if (typeof service.on !== 'function') {
      return;
    }

    const listener = (track) => {
      console.log('[Signature] host remote_media track received', track);
      remoteTrackRef.current = track;
    };

    service.on('remote_media', listener);
    activeHostWebCallingListenerRef.current = listener;
  };

  useEffect(() => {
    if (!interactionId || !webexRef.current) {
      return;
    }

    const callMatch = findCallingCallForInteraction(webexRef.current, interactionId);
    setCallingSummary(callMatch.summary);

    if (callMatch.call) {
      attachCallListener(callMatch.call);
    }
  }, [interactionId]);

  useEffect(() => {
    if (!interactionId) {
      setHostWebCallingSummary('inactive');
      return;
    }

    const hostWebCallingMatch = findHostWebCallingForInteraction(interactionId);
    setHostWebCallingSummary(hostWebCallingMatch.summary);

    if (hostWebCallingMatch.service) {
      attachHostWebCallingListener(hostWebCallingMatch.service);
    }

    if (hostWebCallingMatch.call) {
      attachCallListener(hostWebCallingMatch.call);
    }
  }, [interactionId]);

  useEffect(() => {
    if (!interactionId) {
      setHostTaskSummary('inactive');
      return;
    }

    const hostTaskMatch = findHostTaskForInteraction(interactionId);
    setHostTaskSummary(hostTaskMatch.summary);

    if (hostTaskMatch.task) {
      attachTaskListener(hostTaskMatch.task);
    }
  }, [interactionId]);

  useEffect(() => () => {
    detachCallListener();
    detachTaskListener();
    detachHostWebCallingListener();
  }, []);

  const startRecording = async () => {
    setStatus("Recording Signature...");
    chunksRef.current = [];
    
    try {
      prepareAudioContext();

      const hostWebCallingMatch = findHostWebCallingForInteraction(interactionId);
      setHostWebCallingSummary(hostWebCallingMatch.summary);

      if (hostWebCallingMatch.service) {
        attachHostWebCallingListener(hostWebCallingMatch.service);
      }

      if (hostWebCallingMatch.call) {
        attachCallListener(hostWebCallingMatch.call);

        const hostWebCallingStreams = dedupeAudioStreams(
          [
            getLocalStreamFromCall(hostWebCallingMatch.call),
            getRemoteStreamFromCall(hostWebCallingMatch.call, remoteTrackRef.current)
          ].filter(Boolean)
        );

        if (hostWebCallingStreams.length) {
          setMediaSurface('host-webcalling');

          hostWebCallingStreams.forEach((stream) => {
            const source = audioCtxRef.current.createMediaStreamSource(stream);
            source.connect(mixedDestRef.current);
          });

          mediaRecorderRef.current = new MediaRecorder(mixedDestRef.current.stream, { mimeType: 'audio/webm' });
          mediaRecorderRef.current.ondataavailable = (e) => chunksRef.current.push(e.data);
          mediaRecorderRef.current.onstop = uploadRecording;
          mediaRecorderRef.current.start();
          setIsRecording(true);
          setStatus('Recording Signature from host-webcalling...');
          return;
        }
      }

      const hostTaskMatch = findHostTaskForInteraction(interactionId);
      setHostTaskSummary(hostTaskMatch.summary);

      if (hostTaskMatch.task) {
        attachTaskListener(hostTaskMatch.task);

        const hostTaskStreams = getStreamsFromHostTask(hostTaskMatch.task, remoteTrackRef.current);
        if (hostTaskStreams.length) {
          setMediaSurface('host-task');

          hostTaskStreams.forEach((stream) => {
            const source = audioCtxRef.current.createMediaStreamSource(stream);
            source.connect(mixedDestRef.current);
          });

          mediaRecorderRef.current = new MediaRecorder(mixedDestRef.current.stream, { mimeType: 'audio/webm' });
          mediaRecorderRef.current.ondataavailable = (e) => chunksRef.current.push(e.data);
          mediaRecorderRef.current.onstop = uploadRecording;
          mediaRecorderRef.current.start();
          setIsRecording(true);
          setStatus('Recording Signature from host-task...');
          return;
        }
      }

      const webex = webexRef.current;
      if (!webex) {
        throw new Error('Webex client is not initialized.');
      }

      const callMatch = findCallingCallForInteraction(webex, interactionId);
      setCallingSummary(callMatch.summary);
      setMeetingSummary('not-used');

      if (!callMatch.call) {
        throw new Error('No active WebRTC calling session found for interaction.');
      }

      attachCallListener(callMatch.call);

      const streams = dedupeAudioStreams(
        [
          getLocalStreamFromCall(callMatch.call),
          getRemoteStreamFromCall(callMatch.call, remoteTrackRef.current)
        ].filter(Boolean)
      );
      const surface = 'webrtc-calling';
      setMediaSurface(surface);

      if (!streams.length) {
        throw new Error('Matched the active WebRTC call, but no exposed audio tracks were found.');
      }

      // 2. Mix the streams
      streams.forEach((stream) => {
        if (stream) {
          const source = audioCtxRef.current.createMediaStreamSource(stream);
          source.connect(mixedDestRef.current);
        }
      });

      // 3. Start MediaRecorder
      mediaRecorderRef.current = new MediaRecorder(mixedDestRef.current.stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current.ondataavailable = (e) => chunksRef.current.push(e.data);
      mediaRecorderRef.current.onstop = uploadRecording;
      
      mediaRecorderRef.current.start();
      setIsRecording(true);
      setStatus(`Recording Signature from ${surface}...`);
    } catch (err) {
      console.error("Recording Start Error:", err);
      setStatus(err?.message || "Error starting recording");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setStatus("Processing & Saving...");
    }
  };

  const saveRecordingToDisk = async (blob, fileName) => {
    if (window.showSaveFilePicker) {
      const fileHandle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: [
          {
            description: 'WebM audio',
            accept: {
              'audio/webm': ['.webm']
            }
          }
        ]
      });

      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    }

    const downloadUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = downloadUrl;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(downloadUrl);
  };

  const uploadRecording = async () => {
    const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
    const timestamp = new Date().toISOString().replace(/[.:]/g, '-');
    const fileName = `signature_${interactionId}_${timestamp}.webm`;

    try {
      await saveRecordingToDisk(blob, fileName);
      setStatus("Signature saved to disk");
    } catch (err) {
      if (err?.name === 'AbortError') {
        setStatus("Save cancelled");
        return;
      }

      console.error("Save Error:", err);
      setStatus("Error saving recording");
    }
  };

  return (
    <div className="widget-container">
      <h3>Telephonic Signature</h3>
      <div className="status-badge">{status}</div>
      <p>Interaction: {interactionId || "None"}</p>
      <p>Last event: {resolvedWidgetInteractionId ? 'widget-prop' : lastEvent}</p>

      <div className="diagnostics-panel">
        <div className="diagnostics-title">Diagnostics</div>
        <div className="diagnostics-row">
          <span className="diagnostics-label">iframe</span>
          <span className="diagnostics-value">{isFramed ? 'yes' : 'no'}</span>
        </div>
        <div className="diagnostics-row">
          <span className="diagnostics-label">prop interactionId</span>
          <span className="diagnostics-value">{widgetInteractionId || 'None'}</span>
        </div>
        <div className="diagnostics-row">
          <span className="diagnostics-label">resolved prop interactionId</span>
          <span className="diagnostics-value">{resolvedWidgetInteractionId || 'None'}</span>
        </div>
        <div className="diagnostics-row">
          <span className="diagnostics-label">taskMap interactionId</span>
          <span className="diagnostics-value">{taskMapInteractionId || 'None'}</span>
        </div>
        <div className="diagnostics-row">
          <span className="diagnostics-label">$Store available</span>
          <span className="diagnostics-value">{hasStoreBridge ? 'yes' : 'no'}</span>
        </div>
        <div className="diagnostics-row">
          <span className="diagnostics-label">$Store interactionId</span>
          <span className="diagnostics-value">{storeInteractionId || 'None'}</span>
        </div>
        <div className="diagnostics-row">
          <span className="diagnostics-label">desktop interactionId</span>
          <span className="diagnostics-value">{desktopInteractionId || 'None'}</span>
        </div>
        <div className="diagnostics-row">
          <span className="diagnostics-label">AGENTX_SERVICE</span>
          <span className="diagnostics-value">{hasAgentService ? 'yes' : 'no'}</span>
        </div>
        <div className="diagnostics-row">
          <span className="diagnostics-label">WxccDesktopSDK global</span>
          <span className="diagnostics-value">{hasGlobalSdk ? 'yes' : 'no'}</span>
        </div>
        <div className="diagnostics-row">
          <span className="diagnostics-label">last desktop event</span>
          <span className="diagnostics-value">{lastEvent}</span>
        </div>
        <div className="diagnostics-row">
          <span className="diagnostics-label">media surface</span>
          <span className="diagnostics-value">{mediaSurface}</span>
        </div>
        <div className="diagnostics-row">
          <span className="diagnostics-label">meeting sessions</span>
          <span className="diagnostics-value">{meetingSummary}</span>
        </div>
        <div className="diagnostics-row">
          <span className="diagnostics-label">webrtc call sessions</span>
          <span className="diagnostics-value">{callingSummary}</span>
        </div>
        <div className="diagnostics-row">
          <span className="diagnostics-label">host task surface</span>
          <span className="diagnostics-value">{hostTaskSummary}</span>
        </div>
        <div className="diagnostics-row">
          <span className="diagnostics-label">host webcalling</span>
          <span className="diagnostics-value">{hostWebCallingSummary}</span>
        </div>
      </div>
      
      <div className="controls">
        {!isRecording ? (
          <button disabled={!interactionId} onClick={startRecording} className="btn-start">
            Start Signature Recording
          </button>
        ) : (
          <button onClick={stopRecording} className="btn-stop">
            Stop & Save Signature
          </button>
        )}
      </div>
    </div>
  );
};

export default App;
