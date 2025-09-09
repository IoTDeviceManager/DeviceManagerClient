import { useEffect, useRef } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";
import { API_BASE, checkToken } from "../common";

export default function TerminalComponent() {
  const terminalRef = useRef(null);
  const fitAddon = useRef(null);
  const socketRef = useRef(null);

  useEffect(() => {
    checkToken();

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "monospace",
      fontSize: 14,
      scrollback: 1000,
      disableStdin: false,
    });

    const fit = new FitAddon();
    fitAddon.current = fit;
    term.loadAddon(fit);

    term.open(terminalRef.current);
    fit.fit();
    term.focus();

    const handleResize = () => {
      fit.fit();
    };
    window.addEventListener("resize", handleResize);

    const token = localStorage.getItem("token");
    const ws = new WebSocket(`${API_BASE.replace("http", "ws")}/base/ws/ssh?token=${token}`);
    socketRef.current = ws;

    ws.onopen = () => {
      term.writeln("Connected to SSH session.");
    };

    ws.onmessage = (event) => {
      term.write(event.data);
    };

    ws.onclose = () => {
      term.writeln("\r\nDisconnected.");
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    return () => {
      ws.close();
      term.dispose();
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div
        ref={terminalRef}
        style={{
          height: "calc(100vh - 4rem)",
          width: "calc(90vw - 220px)",
          backgroundColor: "black",
          flex: 1,
        }}
      />
    </div>
  );
}
