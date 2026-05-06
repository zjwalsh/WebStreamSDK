import React, { useEffect, useState, useRef } from 'react';
import { Desktop } from "@wxcc-desktop/sdk";
import Webex from "webex";
import './App.css';

const App = () => {
  const [interactionId, setInteractionId] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("Ready");

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const audioCtxRef = useRef(null);
  const mixedDestRef = useRef(null);
  const webexRef = useRef(null);

  useEffect(() => {
    const initSDK = async () => {
      // config.init() fetches widget metadata from the desktop shell.
      // It fails for custom widgets because the shell has no record of them.
      // We catch and continue — event registration works independently.
      try {
        await Desktop.config.init();
        console.log("[Signature] config.init() succeeded");
      } catch (err) {
        console.warn("[Signature] config.init() failed (expected for custom widgets):", err.message);
      }

      // Register events and read current task outside the init try/catch
      // so a failed init doesn't block either operation.
      try {
        const selectedTask = Desktop.agentContact.taskSelected;
        console.log("[Signature] taskSelected at mount:", selectedTask);
        if (selectedTask?.interactionId) {
          setInteractionId(selectedTask.interactionId);
          prepareAudioContext();
        }

        Desktop.agentContact.addEventListener("eAgentContact", (event) => {
          console.log("[Signature] eAgentContact state:", event.data?.state, event.data);
          if (event.data.state === "Connected") {
            setInteractionId(event.data.interactionId);
            prepareAudioContext();
          } else if (event.data.state === "Ended") {
            setInteractionId(null);
            setStatus("Ready");
          }
        });

        console.log("[Signature] Event listener registered");
      } catch (err) {
        console.error("[Signature] Event registration failed:", err);
      }
    };

    initSDK();

    webexRef.current = Webex.init({
      config: { meetings: { deviceType: 'WEB' } },
      credentials: { access_token: "REPLACE_WITH_AGENT_OAUTH_TOKEN" }
    });
  }, []);

  const prepareAudioContext = () => {
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
      setStatus("Processing & Sending...");
    }
  };

  const uploadRecording = async () => {
    const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
    const formData = new FormData();
    formData.append("file", blob, `signature_${interactionId}.webm`);
    formData.append("interactionId", interactionId);

    try {
      const response = await fetch("https://your-third-party-api.com/upload", {
        method: "POST",
        body: formData
      });
      if (response.ok) setStatus("Signature Sent Successfully!");
      else setStatus("Upload Failed");
    } catch (err) {
      setStatus("Network Error during upload");
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
