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
  const prevIdRef = useRef(null);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const audioCtxRef = useRef(null);
  const mixedDestRef = useRef(null);
  const webexRef = useRef(null);
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

  const startRecording = async () => {
    setStatus("Recording Signature...");
    chunksRef.current = [];
    
    try {
      // 1. Get the local (Agent) and remote (Customer) streams from Webex SDK
      await webexRef.current.meetings.syncMeetings();
      const meetings = webexRef.current.meetings.getAllMeetings();
      const meeting = Object.values(meetings).find(m => m.id.includes(interactionId) || m.correlationId === interactionId);

      if (!meeting) throw new Error("No active meeting found for interaction.");

      // 2. Mix the streams
      const streams = [meeting.localAudioStream, meeting.remoteAudioStream];
      streams.forEach(stream => {
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
