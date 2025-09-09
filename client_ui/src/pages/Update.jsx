import { useRef, useState, useEffect } from "react";
import axios from "axios";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";
import { API_BASE, checkToken } from "../common";
import {
  Container,
  Typography,
  Card,
  CardContent,
  Button,
  Box,
  LinearProgress,
  Alert,
  Chip,
  Paper,
  Divider,
  IconButton,
  Tooltip,
  Stack
} from "@mui/material";
import {
  CloudUpload as UploadIcon,
  PlayArrow as StartIcon,
  Download as DownloadIcon,
  Info as InfoIcon,
  CheckCircle as CheckIcon,
  Schedule as ScheduleIcon
} from "@mui/icons-material";

function formatTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1); // Months are zero-indexed
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const ss = pad(date.getSeconds());

  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

export default function Update() {
  const terminalRef = useRef(null);
  const fitAddon = useRef(null);
  const terminalContainerRef = useRef(null);
  const logsRef = useRef([]);
  const logOffsetRef = useRef(0);
  const [uploadSuccess, setUploadSuccess] = useState(false); // Indicates whether the upload has succeeded
  const [file, setFile] = useState(null); // Indicates that a file has been chosen to be staged for upload
  const [currentVersion, setCurrentVersion] = useState("Loading...")
  const [targetVersion, setTargetVersion] = useState("Loading...")
  const [uploading, setUploading] = useState(false); // Indicates that update button has been clicked
  const [updatePolling, setUpdatePolling] = useState(false); // For start update call

  const AUTH_HEADER = {
    Authorization: `Bearer ${localStorage.getItem("token")}`,
  };

  const uploadButtonDisabled = () => {
    // Don't let user upload if an upload is taking place, or no file has been selected to be uploaded
    return uploading || !file;
  }

  const startUpdateButtonDisabled = () => {
    // Don't let the user start an update if:
    // 1. An upload is in progress but not yet successful
    // 2. The current version matches the target version
    // 3. The target version is not set in the bundle
    // 4. The target version is malformed
    return (
      (uploading && !uploadSuccess) ||
      (currentVersion === targetVersion) ||
      (targetVersion === "Loading...") ||
      (targetVersion === "Unknown")
    );
  };

  const handleFileChange = (e) => {
    setFile(e.target.files?.[0] || null);
  };

  const writeLog = (message) => {
    const lines = message.split("\n").filter(Boolean); // drop empty lines
    for (const line of lines) {
      const timestamped = `[${formatTimestamp()}] ${line}`;
      logsRef.current.push(timestamped);
      if (terminalRef.current) {
        terminalRef.current.writeln(timestamped);
      }
    }
    if (terminalRef.current) {
      terminalRef.current.scrollToBottom();
    }
  };

  const uploadFile = async () => {
    if (!file) return;
    const formData = new FormData();
    const fileName = file.name;
    formData.append("file", file);
    formData.append("total_size", file.size);

    setUploadSuccess(false);
    setUploading(true);
    writeLog("Starting upload...");
    let counter = 0;

    try {
      let lastDiskWritePercent = -1;
      let lastDecryptionStage = "";
      
      const pollInterval = setInterval(async () => {
        try {
          const progressRes = await axios.get(
            `${API_BASE}/updates/upload/progress`,
            {
              params: { filename: fileName },
              headers: {
                ...AUTH_HEADER,
              },
            }
          );

          const {
            disk_write_percent = 0,
            upload_version = "Unknown",
            decryption_elapsed_secs = 0,
            decryption_remaining_secs = 0,
          } = progressRes.data;

          // Upload stage logging
          if (disk_write_percent < 100) {
            if (disk_write_percent !== lastDiskWritePercent) {
              writeLog(`Writing to disk ${disk_write_percent}% complete...`);
              lastDiskWritePercent = disk_write_percent;
            }
          } else if (lastDiskWritePercent !== 100) {
            writeLog("Disk write fully completed. Starting decryption...");
            lastDiskWritePercent = 100;
          }

          // Decryption stage logging
          if (disk_write_percent === 100) {
            if (upload_version && typeof upload_version === "string" && upload_version.trim() !== "") {
              // Decryption is complete
              if (lastDecryptionStage !== "done") {
                writeLog("Upload and decryption complete!");
                writeLog(`Target version: ${upload_version}.`);
                setTargetVersion(upload_version);
                lastDecryptionStage = "done";
                setUploadSuccess(true);
                setUploading(false);
                clearInterval(pollInterval);
              }
            } else {
              // Still decrypting
              if (lastDecryptionStage !== "in_progress") {
                writeLog("Decryption started...");
                lastDecryptionStage = "in_progress";
              }
              writeLog(
                `Decryption elapsed: ${
                  Math.round(decryption_elapsed_secs) === 0
                    ? "Unknown"
                    : Math.round(decryption_elapsed_secs)
                }s, approx. remaining: ${
                  Math.round(decryption_remaining_secs) === 0
                    ? "Unknown"
                    : Math.round(decryption_remaining_secs)
                }s`
              );
            }
          }

        } catch (e) {
          console.error("Error polling processing progress:", e);
        }
      }, 1000);

      axios.post(`${API_BASE}/updates/upload`, formData, {
        headers: {
          ...AUTH_HEADER,
          "Content-Type": "multipart/form-data",
        },
        onUploadProgress: (progressEvent) => {
          const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          if ((counter % 5) === 0) {
            writeLog(`Upload progress: ${percent}%`);
          }
          counter += 1;
        },
      })
      .then((res) => {
        writeLog(res.data.status);
      })
      .catch((err) => {
        if (err.response) {
          // Server responded with 4xx/5xx
          writeLog(`Bundle Error: ${err.response.data.detail}`);
        } else {
          // Network or unexpected error
          writeLog(`Unexpected error: ${err.message}`);
        }
      });
      
    } catch (err) {
      writeLog(err);
    }
  };

  const startUpdate = async () => {
    writeLog("Starting update...");
    logOffsetRef.current = 0;
    try {
      setUpdatePolling(true);
      await axios.post(`${API_BASE}/updates/update`, "", {
        headers: AUTH_HEADER,
      });
    } catch (err) {
      console.error(err);
    }
  };

  // Poll update progress after starting update
  useEffect(() => {
    checkToken();
    if (!updatePolling) return;

    const interval = setInterval(async () => {
      try {

        const res = await axios.get(`${API_BASE}/updates/update-progress`, {
          headers: AUTH_HEADER,
        });
        const { percent, log, status } = res.data;

        if (status === "extracting") {
          writeLog(`Extracting bundle - approximately ${percent}% complete.`)
        }

        if (log && typeof log === "string" && status === "running") {
          const newLog = log.slice(logOffsetRef.current);
          if (newLog) {
            writeLog(newLog);
            logOffsetRef.current = log.length;
          }
        }
        if (status === "complete" || status === "error") {
          const newLog = log.slice(logOffsetRef.current);
          writeLog(newLog);
          writeLog(`Update ${status}.`);
          logOffsetRef.current = log.length;
          clearInterval(interval);
          setUpdatePolling(false);
          setCurrentVersion(targetVersion);
          setTargetVersion(targetVersion);
        }
      } catch (err) {
        console.error(err);
        writeLog("Failed to fetch update progress.");
        clearInterval(interval);
        setUpdatePolling(false);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [updatePolling]);

  useEffect(() => {
    checkToken();
    if (terminalRef.current) return;

    // Inner async function to safely call the async version function
    const init = async () => {
      const results = await Promise.allSettled([
        axios.get(`${API_BASE}/updates/version`, { headers: AUTH_HEADER }),
        axios.get(`${API_BASE}/updates/version/staged`, { headers: AUTH_HEADER }),
      ]);

      if (results[0].status === "fulfilled") {
        setCurrentVersion(results[0].value.data);
      } else {
        console.error("Failed to get current version:", results[0].reason);
      }

      if (results[1].status === "fulfilled") {
        setTargetVersion(results[1].value.data);
      } else {
        console.error("Failed to get target version:", results[1].reason);
      }
    };

    init(); // Call the async setup function

    // Set up terminal
    const term = new Terminal({
      theme: {
        background: "#ffffff",
        foreground: "#000000",
        selectionBackground: "rgba(0, 123, 255, 0.3)",
        selectionForeground: "#000000",
      },
      cursorBlink: true,
      fontFamily: "monospace",
      fontSize: 14,
      scrollback: 1000,
      disableStdin: false,
    });
  

    const fit = new FitAddon();
    fitAddon.current = fit;
    term.loadAddon(fit);
    term.open(terminalContainerRef.current);
    fit.fit();
    terminalRef.current = term;

    const handleResize = () => {
      fit.fit();
    };

    window.addEventListener("resize", handleResize);
    term.writeln("Terminal ready.");
  }, []);

  const getVersionChipColor = (version, isTarget = false) => {
    if (version === "Loading...") return "default";
    if (version === "Unknown") return "warning";
    if (isTarget && uploadSuccess) return "success";
    return "primary";
  };

  const getVersionIcon = (version, isTarget = false) => {
    if (version === "Loading...") return <ScheduleIcon fontSize="small" />;
    if (isTarget && uploadSuccess) return <CheckIcon fontSize="small" />;
    return <InfoIcon fontSize="small" />;
  };

  return (
    <Container maxWidth="lg" sx={{ py: 4, minHeight: 'calc(100vh - 4rem)', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>


      {/* Upload and Update Controls */}
      <Card sx={{ boxShadow: 3, mb: 4 }}>
        <CardContent sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3, flexWrap: 'wrap', gap: 2 }}>
            <Typography variant="h5" sx={{ fontWeight: 'medium' }}>
              Update Controls
            </Typography>
            {/* Version Information */}
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
                  Current
                </Typography>
                <Chip
                  icon={getVersionIcon(currentVersion)}
                  label={currentVersion}
                  color={getVersionChipColor(currentVersion)}
                  variant="outlined"
                  size="small"
                  sx={{ fontWeight: 'medium', fontSize: '0.8rem' }}
                />
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
                  Target
                </Typography>
                <Chip
                  icon={getVersionIcon(targetVersion, true)}
                  label={targetVersion}
                  color={getVersionChipColor(targetVersion, true)}
                  variant="outlined"
                  size="small"
                  sx={{ fontWeight: 'medium', fontSize: '0.8rem' }}
                />
              </Box>
            </Box>
          </Box>
          <Divider sx={{ mb: 3 }} />
          
          <Stack spacing={3}>
            {/* File Upload Section */}
            <Box>
              <Typography variant="h6" sx={{ mb: 2, color: 'text.secondary' }}>
                1. Select Update Package
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                <Button
                  variant="outlined"
                  component="label"
                  startIcon={<UploadIcon />}
                  sx={{ minWidth: 200 }}
                >
                  Choose File
                  <input
                    type="file"
                    accept=".tar.gz.enc"
                    onChange={handleFileChange}
                    hidden
                  />
                </Button>
                {file && (
                  <Chip 
                    label={file.name} 
                    color="primary" 
                    variant="outlined"
                    sx={{ maxWidth: 300, '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }}
                  />
                )}
              </Box>
              {!file && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1, fontStyle: 'italic' }}>
                  Select a .tar.gz.enc update package file
                </Typography>
              )}
            </Box>

            {/* Progress Bar */}
            {uploading && (
              <Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Upload in progress...
                </Typography>
                <LinearProgress />
              </Box>
            )}

            {/* Upload Success Alert */}
            {uploadSuccess && (
              <Alert severity="success" sx={{ borderRadius: 2 }}>
                Upload completed successfully! Ready to start update.
              </Alert>
            )}

            {/* Action Buttons */}
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <Button
                variant="contained"
                size="large"
                startIcon={<UploadIcon />}
                onClick={uploadFile}
                disabled={uploadButtonDisabled()}
                sx={{ 
                  minWidth: 140,
                  bgcolor: uploading ? 'action.disabledBackground' : 'primary.main',
                  '&:hover': {
                    bgcolor: uploading ? 'action.disabledBackground' : 'primary.dark'
                  }
                }}
              >
                {uploading ? 'Uploading...' : 'Upload'}
              </Button>

              <Button
                variant="contained"
                size="large"
                color="success"
                startIcon={<StartIcon />}
                onClick={startUpdate}
                disabled={startUpdateButtonDisabled()}
                sx={{ 
                  minWidth: 140,
                  bgcolor: updatePolling ? 'action.disabledBackground' : 'success.main',
                  '&:hover': {
                    bgcolor: updatePolling ? 'action.disabledBackground' : 'success.dark'
                  }
                }}
              >
                {updatePolling ? 'Updating...' : 'Start Update'}
              </Button>
            </Box>

            {/* Status Information */}
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
              {startUpdateButtonDisabled() && !uploading && (
                <Typography variant="body2" color="text.secondary">
                  {currentVersion === targetVersion && targetVersion !== "Loading..." && targetVersion !== "Unknown" 
                    ? "System is already up to date" 
                    : "Upload a file first to enable update"}
                </Typography>
              )}
            </Box>
          </Stack>
        </CardContent>
      </Card>

      {/* Terminal Output */}
      <Card sx={{ boxShadow: 3, display: 'flex', flexDirection: 'column' }}>
        <CardContent sx={{ p: 0, display: 'flex', flexDirection: 'column' }}>
          <Box sx={{ p: 3, pb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h5" sx={{ fontWeight: 'medium' }}>
              Console Output
            </Typography>
            <Tooltip title="Download logs as text file">
              <IconButton
                onClick={() => {
                  if (!logsRef.current) return;

                  const logText = logsRef.current.join("\n");
                  const blob = new Blob([logText], { type: "text/plain" });
                  const url = URL.createObjectURL(blob);

                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "update_logs.txt";
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                }}
                color="primary"
                size="large"
              >
                <DownloadIcon />
              </IconButton>
            </Tooltip>
          </Box>
          
          <Paper
            ref={terminalContainerRef}
            sx={{
              mx: 3,
              mb: 3,
              height: 400,
              bgcolor: '#ffffff',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 2,
              overflow: 'hidden',
              '& .xterm': {
                padding: '12px'
              }
            }}
          />
        </CardContent>
      </Card>
    </Container>
  );
}
