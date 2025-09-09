import { useEffect, useState } from "react";
import axios from "axios";
import { API_BASE, checkToken } from "../common";
import {
  Box,
  Button,
  Card,
  CardContent,
  Typography,
  Grid,
  Chip,
  Alert,
  CircularProgress,
  LinearProgress,
  Stack,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions
} from '@mui/material';
import {
  Settings as SettingsIcon,
  Sync as SyncIcon,
  RestartAlt as RestartAltIcon,
  ListAlt as ListAltIcon
} from '@mui/icons-material';

function pretty(val) {
  return val === undefined || val === null || val === "" ? "N/A" : val;
}

const ActionButtonWrapper = ({ callback, icon, title, bgColor, hoverColor }) => {
  const [loading, setLoading] = useState(false);

  return loading ? (
    <Box sx={{ display: "flex", flexDirection: "row", width: "100%", justifyContent: "center" }}>
      <CircularProgress />
    </Box>
  ) : (
    <Button
      fullWidth
      variant="contained"
      onClick={() => callback(setLoading)}
      startIcon={icon}
      sx={{ backgroundColor: bgColor, '&:hover': { backgroundColor: hoverColor } }}
    >
      <Typography sx={{ fontSize: { xs: 8, sm: 9, md: 10, lg: 11, xl: 12 } }}>
        {title}
      </Typography>
    </Button>
  );
};

export default function Main() {
  const [systemData, setSystemData] = useState(null);
  const [error, setError] = useState("");
  const [openModal, setOpenModal] = useState(false);
  const [modalTitle, setModalTitle] = useState("");
  const [modalDetails, setModalDetails] = useState("");
  const [reload, setReload] = useState(0);

  const AUTH_HEADER = {
    Authorization: `Bearer ${localStorage.getItem("token")}`,
  };

  const handleSync = async (setLoading) => {
    setLoading(true);
    try {
      const now = new Date();
      const formatted = now.toISOString().slice(0, 19).replace("T", " ");
      const res = await axios.post(
        `${API_BASE}/base/date`,
        new URLSearchParams({ date: formatted }),
        {
          headers: AUTH_HEADER,
          "Content-Type": "application/x-www-form-urlencoded"
        }
      );
      setReload((prev) => prev + 1);
      setModalTitle("✅ Success");
      setModalDetails(res.data.message || "time sync completed");
    } catch (err) {
      const errorMessage = err.response?.data || err.message;
      setModalTitle("❌ Error");
      setModalDetails(errorMessage);
    }
    setLoading(false);
    setOpenModal(true);
  };

  const handleReset = async (setLoading) => {
    setLoading(true);
    try {
      const res = await axios.post(
        `${API_BASE}/base/reboot`, null,
        {
          headers: AUTH_HEADER
        }
      );
      setReload((prev) => prev + 1);
      setModalTitle("✅ Success");
      setModalDetails(res.data.message || "device reboot in progress");
    } catch (err) {
      const errorMessage = err.response?.data || err.message;
      setModalTitle("❌ Error");
      setModalDetails(errorMessage);
    }
    setLoading(false);
    setOpenModal(true);
  };

  const handleRestartServices = async (setLoading) => {
    setLoading(true);
    try {
      const res = await axios.post(
        `${API_BASE}/base/restart_services`,
        null,
        {
          headers: AUTH_HEADER,
          responseType: "text", // ensures Axios treats it as plain text
        }
      );

      // Success
      setReload((prev) => prev + 1);
      setModalTitle("✅ Success");
      setModalDetails(res.data || "Services restarted successfully");
    } catch (err) {
      const errorMessage = err.response?.data || err.message;
      setModalTitle("❌ Error");
      setModalDetails(errorMessage);
    } finally {
      setLoading(false);
      setOpenModal(true);
    }
  };

  const handleShowServiceLogs = async (setLoading) => {
    setLoading(true);
    try {
      const res = await axios.get(
        `${API_BASE}/base/logs`,
        {
          headers: AUTH_HEADER,
          responseType: "text",
        }
      );

      // Success
      setReload((prev) => prev + 1);
      setModalTitle("✅ Success");
      setModalDetails(res.data.repeat(2) || "No logs to show");
    } catch (err) {
      const errorMessage = err.response?.data || err.message;
      setModalTitle("❌ Error");
      setModalDetails(errorMessage);
    } finally {
      setLoading(false);
      setOpenModal(true);
    }
  };

  // Fetch system data
  useEffect(() => {
    checkToken();
    const fetchSystemData = () => {
      setError("");
      axios
        .get(`${API_BASE}/base/health`, { headers: AUTH_HEADER })
        .then((res) => {
          setSystemData(res.data);
        })
        .catch((err) => setError(err.response?.data?.detail || err.message));
    };

    fetchSystemData();
    // Refresh every 30 seconds
    const interval = setInterval(fetchSystemData, 30000);
    return () => clearInterval(interval);
  }, [reload]);

  const MetricRow = ({ label, value, color = "text.primary" }) => (
    <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={600} color={color}>
        {pretty(value)}
      </Typography>
    </Box>
  );

  const CardWrapper = ({ title, children, center = false }) => {
    return (
      <Grid size={{ xs: 12, sm: 12, md: 12, lg: 4, xl: 4 }}>
        <Card
          sx={{
            height: 300,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <CardContent
            sx={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Title always at top */}
            <Box display="flex" alignItems="center" mb={2}>
              <SettingsIcon color="primary" sx={{ mr: 1 }} />
              <Typography variant="h6" component="h2">
                {title}
              </Typography>
            </Box>

            {/* Children either centered or flow normally */}
            <Box
              sx={
                center
                  ? {
                      flex: 1,
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                    }
                  : {}
              }
            >
              {children}
            </Box>
          </CardContent>
        </Card>
      </Grid>
    );
  };

  const ProgressBar = ({progress}) => {
    return (
      <Box sx={{ width: "100%", mt: 5 }}>
        <LinearProgress
          variant="determinate"
          value={parseInt(progress?.replace('%', '') ?? "0", 10)}
          sx={{
            height: 10,
            borderRadius: 5,
            backgroundColor: 'lightgray',
            '& .MuiLinearProgress-bar': {
              backgroundColor:
                parseInt(progress?.replace('%', '') ?? "0", 10) > 80
                  ? 'red'
                  : 'blue',
            },
          }}
        />
      </Box>
    );
  }

  if (error) {
    return (
      <Box p={3}>
        <Alert severity="error">
          Error loading system data: {error}
        </Alert>
      </Box>
    );
  }

  if (!systemData) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="calc(100vh - 4rem)">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, justifyContent: 'center', alignItems: 'center', minHeight: 'calc(100vh - 4rem)' }}>
      {/* Top row: Docker, System Info, Device Actions */}
      <Grid container spacing={3} mb={3} sx={{ width: '90%' }}>

        {/* Running Services Card */}
        <CardWrapper title="Running Services" >
          <Box sx={{ overflowY: "auto", maxHeight: 210 }}>
            {systemData.docker?.containers?.length > 0 ? (
              <Stack spacing={1}>
                {systemData.docker.containers.map((container, idx) => (
                  <Card key={idx} variant="outlined" sx={{ p: 1.5 }}>
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={0.5}>
                      <Typography variant="subtitle2" fontWeight={600}>
                        {container.name}
                      </Typography>
                      <Chip
                        label={container.state}
                        color={container.state === "running" ? "success" : "error"}
                        size="small"
                        variant="outlined"
                      />
                    </Box>
                    <Typography variant="caption" color="text.secondary" display="block">
                      {container.image}
                    </Typography>
                    <Typography variant="caption" color="text.disabled">
                      {container.status}
                    </Typography>
                  </Card>
                ))}
              </Stack>
            ) : (
              <Box display="flex" justifyContent="center" alignItems="center" height={200}>
                <Typography color="text.secondary">
                  No services found
                </Typography>
              </Box>
            )}
          </Box>
        </CardWrapper>

        {/* System Info Card */}
        <CardWrapper title="System Information" >
          <Stack spacing={1}>
            <MetricRow label="IoT Manager Version" value={systemData.manager_version} />
            <MetricRow label="Software Version" value={systemData.software_version} />
            <MetricRow label="OS" value={`${systemData.os} ${systemData.architecture}`} />
            <MetricRow label="Distro" value={`${systemData.distro} ${systemData.distro_version}`} />
            <MetricRow label="System Time" value={systemData.timestamp} />
            <MetricRow label="Uptime" value={systemData.uptime} />
            <MetricRow label="Last Boot" value={systemData.boot_time} />
            <MetricRow 
              label="Temperature" 
              value={systemData.temperature?.system} 
              color="error.main" 
            />
          </Stack>
        </CardWrapper>

        {/* Device Actions Card */}
        <CardWrapper title="Device Actions" center={true}>
          <Grid container spacing={3} >
            <Grid size={6}>
              <ActionButtonWrapper
                callback={handleSync}
                icon={<SyncIcon />}
                title="Synchronize Time"
                bgColor="#4caf50"
                hoverColor="#43a047"
              />
            </Grid>
            <Grid size={6}>
              <ActionButtonWrapper
                callback={handleReset}
                icon={<RestartAltIcon />}
                title="Reboot System"
                bgColor="#f44336"
                hoverColor="#d32f2f"
              />
            </Grid>
            <Grid size={6}>
              <ActionButtonWrapper
                callback={handleRestartServices}
                icon={<RestartAltIcon />}
                title="Restart Services"
                bgColor="#2196f3"
                hoverColor="#1976d2"
              />
            </Grid>
            <Grid size={6}>
              <ActionButtonWrapper
                callback={handleShowServiceLogs}
                icon={<ListAltIcon />}
                title="Show Service Logs"
                bgColor="#ff9800"
                hoverColor="#fb8c00"
              />
            </Grid>
          </Grid>
        </CardWrapper>
      </Grid>

      {/* Bottom row: CPU, Memory, Storage */}
      <Grid container spacing={3} mb={3} sx={{ width: '90%' }}>
        
        {/* CPU Info Card */}
        <CardWrapper title="CPU Usage" >
          <Stack spacing={2}>
            <MetricRow label="Cores" value={systemData.cpu_cores} />
            <MetricRow label="Load (15m)" value={systemData.load_15m} />
            <MetricRow 
              label="Load Status" 
              value={systemData.load_status}
              color={systemData.load_status === "OK" ? "success.main" : "error.main"}
            />
            <MetricRow 
              label="Usage" 
              value={systemData.cpu_usage} 
              color="error.main" 
            />
          </Stack>
          <ProgressBar progress={systemData.cpu_usage} />
        </CardWrapper>

        {/* Memory Info Card */}
        <CardWrapper title="Memory Usage" >
          <Stack spacing={2}>
            <MetricRow label="Total" value={systemData.memory_total} />
            <MetricRow 
              label="Used" 
              value={systemData.memory_used} 
              color="error.main" 
            />
            <MetricRow 
              label="Available" 
              value={systemData.memory_available} 
              color="success.main" 
            />
            <MetricRow 
              label="Usage %" 
              value={systemData.memory_usage} 
              color="error.main" 
            />
          </Stack>
          <ProgressBar progress={systemData.memory_usage} />
        </CardWrapper>

        {/* Storage Info Card */}
        <CardWrapper title="Storage Usage" >
          <Stack spacing={2}>
            <MetricRow label="Total" value={systemData.disk_total} />
            <MetricRow 
              label="Used" 
              value={systemData.disk_used} 
              color="error.main" 
            />
            <MetricRow 
              label="Free" 
              value={systemData.disk_free} 
              color="success.main" 
            />
            <MetricRow 
              label="Usage %" 
              value={systemData.disk_usage} 
              color="error.main" 
            />
          </Stack>
          <ProgressBar progress={systemData.disk_usage} />
        </CardWrapper>
      </Grid>
      <Dialog open={openModal} onClose={() => setOpenModal(false)} maxWidth="md" fullWidth>
        <DialogTitle>{modalTitle}</DialogTitle>
        <DialogContent
          dividers
          sx={{
            maxHeight: 400,
            backgroundColor: "#1e1e1e",
            color: "#fff",
            fontFamily: "monospace",
            padding: 2,
          }}
        >
          <Typography component="pre">
            {modalDetails}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenModal(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
