import React, { useEffect, useState, useRef } from 'react';
import { Desktop } from "@wxcc-desktop/sdk";
import Webex from "webex";
import './App.css';

const App = ({ interactionId: widgetInteractionId = null }) => {
  const [desktopInteractionId, setDesktopInteractionId] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("Ready");
  const prevIdRef = useRef(null);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const audioCtxRef = useRef(null);
  const mixedDestRef = useRef(null);
  const webexRef = useRef(null);
  const interactionId = widgetInteractionId ?? desktopInteractionId;

  useEffect(() => {
    if (widgetInteractionId) {
      return undefined;
    }

    const poll = setInterval(() => {
      try {
        const id = Desktop.agentContact.taskSelected?.interactionId || null;
        setDesktopInteractionId(id);
      } catch (e) {}
    }, 1000);

    webexRef.current = Webex.init({
      config: { meetings: { deviceType: 'WEB' } },
      credentials: { access_token: "REPLACE_WITH_AGENT_OAUTH_TOKEN" }
    });

    return () => clearInterval(poll);
  }, [widgetInteractionId]);

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
      setStatus("Error starting recording");
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
