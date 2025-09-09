import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { API_BASE, checkToken } from "../common";
import {
  Container,
  Typography,
  Card,
  CardContent,
  CardActions,
  Button,
  Box,
  Alert,
  Grid,
  TextField,
  FormControl,
  FormLabel,
  RadioGroup,
  FormControlLabel,
  Radio,
  Select,
  MenuItem,
  InputLabel,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Chip,
  CircularProgress,
  Stack
} from "@mui/material";
import {
  NetworkWifi as WifiIcon,
  Cable as EthernetIcon,
  Refresh as RefreshIcon,
  Settings as ConfigureIcon,
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Save as SaveIcon,
  CheckCircle as CheckIcon,
  Error as ErrorIcon,
  Dns as DnsIcon
} from "@mui/icons-material";

function pretty(val) {
  return val === undefined || val === null || val === "" ? "N/A" : val;
}

const TestNetworkWidget = () => {
  const [url, setUrl] = useState("");
  const urlRef = useRef("");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);

  const isValidUrl = (value) => {
    try {
      const u = new URL(value);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  };

  const testConnection = async () => {
    urlRef.current = url;
    if (!isValidUrl(url)) {
      setResult({ status: "Invalid URL. Please include http:// or https://", color: "red" });
      return;
    }

    setTesting(true);
    setResult(null);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const resp = await fetch(url, { method: "GET", signal: controller.signal });
      clearTimeout(timeoutId);

      if (resp.ok) {
        setResult({ status: "reachable", color: "green" });
      } else {
        setResult({ status: `unreachable (status ${resp.status})`, color: "red" });
      }
    } catch (err) {
      // fallback image ping
      const img = new Image();
      img.onload = () => setResult({ status: "reachable", color: "green" });
      img.onerror = () => setResult({ status: "unreachable", color: "red" });
      img.src = `${url.replace(/\/$/, "")}/favicon.ico?cacheBust=${Date.now()}`;
    }

    setTesting(false);
  };

  return (
    <Card sx={{ mb: 5, p: 3, boxShadow: 4, borderRadius: 3 }}>
      <Typography
        variant="h5"
        sx={{ fontWeight: "bold", color: "primary.main", mb: 2 }}
      >
        🌐 Network Connection Tester
      </Typography>

      <Box sx={{ display: "flex", gap: 2, alignItems: "center" }}>
        <TextField
          label="Enter URL"
          placeholder="https://www.google.com"
          variant="outlined"
          size="small"
          fullWidth
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
          }}
        />
        <Button
          variant="contained"
          onClick={testConnection}
          disabled={testing || !url}
        >
          {testing ? "Testing…" : "Test"}
        </Button>
      </Box>

      {result && (
        <Typography sx={{ mt: 2 }} style={{ color: result.color }}>
          {urlRef.current} is {result.status}
        </Typography>
      )}
    </Card>
  );
};

export default function Network() {
  const [interfaces, setInterfaces] = useState({ ethernet: [], wifi: [] });
  const [details, setDetails] = useState({}); // { ifaceName: {...parsed details...} }
  const [ifaceRefresh, setIfaceRefresh] = useState({});
  const [hosts, setHosts] = useState([]); // [{ ip, names, raw }]
  const [modalOpen, setModalOpen] = useState(false);
  const [modalSuccess, setModalSuccess] = useState("");
  const [modalError, setModalError] = useState("");
  const [modalApplyLoading, setModalApplyLoading] = useState(false);
  const [selectedIface, setSelectedIface] = useState(null);
  const [form, setForm] = useState({}); // form for modal
  const [error, setError] = useState("");
  const [savingRow, setSavingRow] = useState(null); // track which row is being saved
  const [deleteConfirm, setDeleteConfirm] = useState(null); // track which row is being deleted

  const AUTH_HEADER = {
    Authorization: `Bearer ${localStorage.getItem("token")}`,
  };

  const isInterfaceRefreshing = (iface) => {
    if (iface in ifaceRefresh) {
      return ifaceRefresh[iface];
    }
    return false; // Assume hasn't been initialized yet
  };

  const setInterfaceRefreshing = (iface, state) => {
    setIfaceRefresh(prev => ({ ...prev, [iface]: state }));
  };

  const closeModal = () => {
    setModalOpen(false);
    setModalSuccess("");
    setModalError("");
  }

  // --- Fetch interfaces and details ---
  useEffect(() => {
    checkToken();
    setError("");
    let interfaceRefreshes = {};

    const fetchInterfaces = axios.get(`${API_BASE}/network/list_interfaces`, { headers: AUTH_HEADER })
      .then((res) => {
        setInterfaces(res.data || { ethernet: [], wifi: [] });
        const allIfaces = [
          ...(res.data?.ethernet || []),
          ...(res.data?.wifi || []),
        ];
        allIfaces.forEach((iface) => {
          interfaceRefreshes[iface] = false;
          fetchDetails(iface);
        });
      });

    const fetchHosts = axios.get(`${API_BASE}/network/dns/local`, { headers: AUTH_HEADER })
      .then((res) => {
        if (res.data?.entries) {
          setHosts(
            res.data.entries.map((e) => ({
              ip: e.ip || e.address || "",
              names: e.host || e.hosts || e.names || "",
              editing: false,
              saveStatus: ""
            }))
          );
        } else if (typeof res.data?.content === "string") {
          const lines = res.data.content.split("\n");
          const parsed = [];
          for (let line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;
            const parts = trimmed.split(/\s+/);
            if (parts.length >= 2) parsed.push({
              ip: parts[0],
              names: parts.slice(1).join(" "),
              editing: false,
              saveStatus: ""
            });
          }
          setHosts(parsed);
        } else {
          setHosts([]);
        }
      });

    Promise.all([fetchInterfaces, fetchHosts])
      .catch((err) => setError(err.response?.data?.detail || err.message));
  }, []);

  // fetch details for a single interface and store keyed by name
  const fetchDetails = (iface) => {
    setInterfaceRefreshing(iface, true);
    axios
      .get(`${API_BASE}/network/interface/${encodeURIComponent(iface)}`, {
        headers: AUTH_HEADER,
      })
      .then((res) => {
        // normalize backend fields into easy-to-read keys
        const d = res.data || {};
        const normalized = {
          name: iface,
          type: pretty(d.type),
          mtu: pretty(d.mtu),
          status: pretty(d.status),
          mac: pretty(d.mac),
          dns: [d.dns_1, d.dns_2 !== "—" ? d.dns_2 : null].filter(Boolean).map(pretty),
          ipv4: pretty(d.ipv4_addr),
          ipv6: pretty(d.ipv6_addr),
          gateway4: pretty(d.ipv4_gateway),
          gateway6: pretty(d.ipv6_gateway),
          mode: pretty(d.mode),
        };
        setDetails((s) => ({ ...s, [iface]: normalized }));
        setInterfaceRefreshing(iface, false);
      })
      .catch((err) => {
        setDetails((s) => ({
          ...s,
          [iface]: { name: iface, error: err.response?.data?.detail || err.message },
        }));
        setInterfaceRefreshing(iface, false);
      });
  };

  // Open modal to configure an interface
  const openModal = (iface) => {
    setSelectedIface(iface);
    // prefill form from details if present
    const d = details[iface] || {};
    setForm({
      mode: d.mode || "dhcp", // default
      ip_address: d.ipv4 !== "N/A" ? d.ipv4.split("/")[0] : "",
      netmask: "255.255.255.0",
      gateway: d.gateway4 !== "N/A" ? d.gateway4 : "",
      dns: (d.dns && d.dns.length) ? d.dns.join(",") : "8.8.8.8,1.1.1.1",
      ssid: "",
      password: "",
    });
    // if wifi, fetch SSIDs
    if (interfaces.wifi.includes(iface)) {
      axios
        .get(`${API_BASE}/network/wifi/ssids`, { headers: AUTH_HEADER })
        .then((res) => setForm((f) => ({ ...f, ssids: res.data || [] })))
        .catch(() => setForm((f) => ({ ...f, ssids: [] })));
    }
    setModalOpen(true);
  };

  // Save hosts: reconstruct file content and POST as { content: "<text>" }
  const saveHosts = async (rowIdx = null) => {
    if (rowIdx !== null) {
      setSavingRow(rowIdx);
      // Clear any existing save status for this row
      setHosts(prevHosts => prevHosts.map((h, i) => 
        i === rowIdx ? { ...h, saveStatus: "" } : h
      ));
    }
    
    try {
      const lines = [];
      // preserve no comments currently — only user's entries
      hosts.forEach((h) => {
        if ((h.ip || "").trim() && (h.names || "").trim()) {
          lines.push(`${h.ip.trim()} ${h.names.trim()}`);
        }
      });
      const content = lines.join("\n") + (lines.length ? "\n" : "");
      await axios.post(
        `${API_BASE}/network/dns/local`,
        { content },
        { headers: AUTH_HEADER }
      );
      
      if (rowIdx !== null) {
        // Update save status for specific row
        setHosts(prevHosts => prevHosts.map((h, i) => 
          i === rowIdx ? { ...h, saveStatus: "✅ Saved" } : h
        ));
        // Clear the status after 2 seconds
        setTimeout(() => {
          setHosts(prevHosts => prevHosts.map((h, i) => 
            i === rowIdx ? { ...h, saveStatus: "" } : h
          ));
        }, 2000);
      }
    } catch (err) {
      if (rowIdx !== null) {
        setHosts(prevHosts => prevHosts.map((h, i) => 
          i === rowIdx ? { ...h, saveStatus: `❌ Failed: ${err.response?.data?.detail || err.message}` } : h
        ));
      }
    } finally {
      setSavingRow(null);
    }
  };

  const toggleEdit = async (idx, value) => {
    const updated = [...hosts];
    updated[idx].editing = value;
    setHosts(updated);
    
    // If saving (value is false), trigger save operation
    if (!value) {
      await saveHosts(idx);
    }
  };

  const addHost = () => {
    setHosts([...hosts, { ip: "", names: "", editing: true, saveStatus: "" }]);
  }

  const removeHost = async (idx) => {
    setSavingRow(idx);
    try {
      // Create the updated hosts array without the deleted entry
      const updatedHosts = hosts.filter((_, i) => i !== idx);
      
      // Save the updated hosts to the server
      const lines = [];
      updatedHosts.forEach((h) => {
        if ((h.ip || "").trim() && (h.names || "").trim()) {
          lines.push(`${h.ip.trim()} ${h.names.trim()}`);
        }
      });
      const content = lines.join("\n") + (lines.length ? "\n" : "");
      
      await axios.post(
        `${API_BASE}/network/dns/local`,
        { content },
        { headers: AUTH_HEADER }
      );
      
      // Only update state after successful save
      setHosts(updatedHosts);
      
      // Show success message briefly
      setDeleteConfirm({ success: true, deletedEntry: hosts[idx] });
      setTimeout(() => {
        setDeleteConfirm(null);
      }, 2000);
      
    } catch (err) {
      // Show error in the confirmation modal
      setDeleteConfirm({ 
        error: true, 
        message: err.response?.data?.detail || err.message,
        deletedEntry: hosts[idx]
      });
    } finally {
      setSavingRow(null);
    }
  }

  const confirmDelete = (idx) => {
    setDeleteConfirm(idx);
  }

  const updateHost = (idx, field, value) => {
    setHosts((s) => s.map((row, i) => (i === idx ? { ...row, [field]: value } : row)));
  };

  // Configure functions that call backend endpoints from your network.py
  const submitConfig = async (e) => {
    e.preventDefault();
    setModalSuccess("");
    setModalError("");

    if (!selectedIface) {
      setModalSuccess("");
      setModalError("No interface selected");
      return;
    }

    setModalApplyLoading(true);

    try {
      const isEther = interfaces.ethernet.includes(selectedIface);
      const isWifi = interfaces.wifi.includes(selectedIface);
      const mode = form.mode;
      const fd = new FormData();
      fd.append("interface", selectedIface);

      if (isEther) {
        if (mode === "dhcp") {
          await axios.post(`${API_BASE}/network/ethernet/dhcp`, fd, { headers: AUTH_HEADER });
        } else {
          fd.append("ip_address", form.ip_address || "");
          fd.append("netmask", form.netmask || "255.255.255.0");
          fd.append("gateway", form.gateway || "");
          fd.append("dns", form.dns || "8.8.8.8,1.1.1.1");
          await axios.post(`${API_BASE}/network/ethernet/static`, fd, { headers: AUTH_HEADER });
        }
      } else if (isWifi) {
        fd.append("ssid", form.ssid || "");
        fd.append("password", form.password || "");
        if (mode === "dhcp") {
          await axios.post(`${API_BASE}/network/wifi/dhcp`, fd, { headers: AUTH_HEADER });
        } else {
          fd.append("ip_address", form.ip_address || "");
          fd.append("netmask", form.netmask || "255.255.255.0");
          fd.append("gateway", form.gateway || "");
          fd.append("dns", form.dns || "8.8.8.8,1.1.1.1");
          await axios.post(`${API_BASE}/network/wifi/static`, fd, { headers: AUTH_HEADER });
        }
      }

      fetchDetails(selectedIface);
      setModalSuccess(`Interface ${selectedIface} successfully configured!`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      closeModal();
    } catch (err) {
      setModalSuccess("");
      setModalError(err.response?.data?.detail || err.message);
    } finally {
      setModalApplyLoading(false);
    }
  };

  const getStatusChip = (status, isWifi = false) => {
    if (status === "Unknown" || status === "N/A") {
      return <Chip label="Unknown" size="small" variant="outlined" />;
    }
    
    const isConnected = isWifi ? status === "connected" : status === "up";
    
    return (
      <Chip
        label={status}
        size="small"
        color={isConnected ? "success" : "error"}
        variant="outlined"
        sx={{ textTransform: 'capitalize' }}
      />
    );
  };

  const DetailRow = ({ label, value }) => (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.5 }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 'medium', fontFamily: 'monospace' }}>
        {pretty(value)}
      </Typography>
    </Box>
  );

  return (
    <Container maxWidth="xl" sx={{ py: 4, minHeight: 'calc(100vh - 4rem)', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>

      {/* Error Alert */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      <TestNetworkWidget />

      {/* Network Interfaces */}
      <Grid container spacing={3} sx={{ mb: 5 }}>
        {/* Ethernet Cards */}
        {interfaces.ethernet.map((eth) => {
          const d = details[eth] || {};
          const isRefreshing = isInterfaceRefreshing(eth);
          
          return (
            <Grid size={{ xs: 12, sm: 6, lg: 4 }} key={eth}>
              <Card sx={{ boxShadow: 3, height: '100%', display: 'flex', flexDirection: 'column' }}>
                <CardContent sx={{ flex: 1 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <EthernetIcon color="primary" />
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          Ethernet
                        </Typography>
                        <Typography variant="h6" sx={{ fontWeight: 'bold', lineHeight: 1 }}>
                          {eth}
                        </Typography>
                      </Box>
                    </Box>
                    {getStatusChip(d.status)}
                  </Box>

                  <Stack spacing={1}>
                    <DetailRow label="IPv4" value={d.ipv4} />
                    <DetailRow label="Gateway" value={d.gateway4} />
                    <DetailRow label="DNS" value={(d.dns && d.dns.length) ? d.dns.join(", ") : "N/A"} />
                    <DetailRow label="MAC" value={d.mac} />
                    <DetailRow label="Mode" value={d.mode} />
                  </Stack>
                </CardContent>

                <CardActions sx={{ justifyContent: 'flex-end', pt: 0 }}>
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={isRefreshing ? <CircularProgress size={16} /> : <RefreshIcon />}
                    onClick={() => fetchDetails(eth)}
                    disabled={isRefreshing}
                  >
                    {isRefreshing ? 'Loading...' : 'Refresh'}
                  </Button>
                  <Button
                    variant="contained"
                    size="small"
                    startIcon={<ConfigureIcon />}
                    onClick={() => openModal(eth)}
                  >
                    Configure
                  </Button>
                </CardActions>
              </Card>
            </Grid>
          );
        })}

        {/* WiFi Cards */}
        {interfaces.wifi.map((wifi) => {
          const d = details[wifi] || {};
          const isRefreshing = isInterfaceRefreshing(wifi);
          
          return (
            <Grid size={{ xs: 12, sm: 6, lg: 4 }} key={wifi}>
              <Card sx={{ boxShadow: 3, height: '100%', display: 'flex', flexDirection: 'column' }}>
                <CardContent sx={{ flex: 1 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <WifiIcon color="primary" />
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          Wi-Fi
                        </Typography>
                        <Typography variant="h6" sx={{ fontWeight: 'bold', lineHeight: 1 }}>
                          {wifi}
                        </Typography>
                      </Box>
                    </Box>
                    {getStatusChip(d.status, true)}
                  </Box>

                  <Stack spacing={1}>
                    <DetailRow label="IPv4" value={d.ipv4} />
                    <DetailRow label="Gateway" value={d.gateway4} />
                    <DetailRow label="DNS" value={(d.dns && d.dns.length) ? d.dns.join(", ") : "N/A"} />
                    <DetailRow label="MAC" value={d.mac} />
                    <DetailRow label="Mode" value={d.mode} />
                  </Stack>
                </CardContent>

                <CardActions sx={{ justifyContent: 'flex-end', pt: 0 }}>
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={isRefreshing ? <CircularProgress size={16} /> : <RefreshIcon />}
                    onClick={() => fetchDetails(wifi)}
                    disabled={isRefreshing}
                  >
                    {isRefreshing ? 'Loading...' : 'Refresh'}
                  </Button>
                  <Button
                    variant="contained"
                    size="small"
                    startIcon={<ConfigureIcon />}
                    onClick={() => openModal(wifi)}
                  >
                    Configure
                  </Button>
                </CardActions>
              </Card>
            </Grid>
          );
        })}
      </Grid>

      {/* Local DNS Section */}
      <Card sx={{ boxShadow: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
            <DnsIcon color="primary" />
            <Typography variant="h5" sx={{ fontWeight: 'bold' }}>
              Local DNS
            </Typography>
          </Box>
          
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Edit host entries (IP + hostname). Changes are saved automatically when you finish editing.
          </Typography>

          <TableContainer component={Paper} variant="outlined">
            <Table>
              <TableHead>
                <TableRow sx={{ bgcolor: 'grey.50' }}>
                  <TableCell sx={{ fontWeight: 'bold' }}>IP Address</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Hostnames</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 'bold' }}>Actions</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {hosts.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} align="center" sx={{ py: 4 }}>
                      <Typography color="text.secondary">No entries found</Typography>
                    </TableCell>
                  </TableRow>
                )}
                
                {hosts.map((entry, idx) => (
                  <TableRow key={idx} sx={{ '&:hover': { bgcolor: 'action.hover' } }}>
                    <TableCell sx={{ width: 200 }}>
                      <TextField
                        size="small"
                        fullWidth
                        value={entry.ip}
                        onChange={(e) => updateHost(idx, "ip", e.target.value)}
                        placeholder="192.168.1.10"
                        disabled={!entry.editing}
                        variant={entry.editing ? "outlined" : "standard"}
                        InputProps={{ 
                          readOnly: !entry.editing,
                          sx: { 
                            bgcolor: entry.editing ? 'background.paper' : 'action.hover',
                            fontFamily: 'monospace'
                          }
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        fullWidth
                        value={entry.names}
                        onChange={(e) => updateHost(idx, "names", e.target.value)}
                        placeholder="hostname1 hostname2"
                        disabled={!entry.editing}
                        variant={entry.editing ? "outlined" : "standard"}
                        InputProps={{ 
                          readOnly: !entry.editing,
                          sx: { 
                            bgcolor: entry.editing ? 'background.paper' : 'action.hover',
                            fontFamily: 'monospace'
                          }
                        }}
                      />
                    </TableCell>
                    <TableCell align="center">
                      <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center' }}>
                        {entry.editing ? (
                          <IconButton
                            size="small"
                            color="primary"
                            onClick={() => toggleEdit(idx, false)}
                            disabled={savingRow === idx}
                          >
                            {savingRow === idx ? <CircularProgress size={16} /> : <SaveIcon />}
                          </IconButton>
                        ) : (
                          <IconButton
                            size="small"
                            color="primary"
                            onClick={() => toggleEdit(idx, true)}
                          >
                            <EditIcon />
                          </IconButton>
                        )}
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => confirmDelete(idx)}
                        >
                          <DeleteIcon />
                        </IconButton>
                      </Box>
                    </TableCell>
                    <TableCell sx={{ minWidth: 120 }}>
                      {entry.saveStatus && (
                        <Typography
                          variant="caption"
                          sx={{
                            color: entry.saveStatus.startsWith("✅") ? "success.main" : "error.main",
                            fontWeight: 'medium'
                          }}
                        >
                          {entry.saveStatus}
                        </Typography>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          <Box sx={{ mt: 2 }}>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={addHost}
            >
              Add Entry
            </Button>
          </Box>
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        maxWidth="sm"
        fullWidth
      >
        {deleteConfirm?.success ? (
          <>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CheckIcon color="success" />
              Entry Deleted
            </DialogTitle>
            <DialogContent>
              <Typography sx={{ mb: 2 }}>
                Host entry has been successfully removed and saved.
              </Typography>
              <Paper sx={{ p: 2, bgcolor: 'success.50', border: '1px solid', borderColor: 'success.200' }}>
                <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                  {deleteConfirm.deletedEntry?.ip} {deleteConfirm.deletedEntry?.names}
                </Typography>
              </Paper>
            </DialogContent>
          </>
        ) : deleteConfirm?.error ? (
          <>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <ErrorIcon color="error" />
              Delete Failed
            </DialogTitle>
            <DialogContent>
              <Typography sx={{ mb: 2 }}>
                Failed to delete entry: {deleteConfirm.message}
              </Typography>
              <Paper sx={{ p: 2, bgcolor: 'error.50', border: '1px solid', borderColor: 'error.200' }}>
                <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                  {deleteConfirm.deletedEntry?.ip} {deleteConfirm.deletedEntry?.names}
                </Typography>
              </Paper>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDeleteConfirm(null)}>Close</Button>
            </DialogActions>
          </>
        ) : (
          <>
            <DialogTitle>Confirm Delete</DialogTitle>
            <DialogContent>
              <Typography sx={{ mb: 2 }}>
                Are you sure you want to delete this host entry?
              </Typography>
              <Paper sx={{ p: 2, bgcolor: 'grey.50' }}>
                <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                  {hosts[deleteConfirm]?.ip} {hosts[deleteConfirm]?.names}
                </Typography>
              </Paper>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDeleteConfirm(null)}>Cancel</Button>
              <Button
                color="error"
                variant="contained"
                onClick={() => removeHost(deleteConfirm)}
                disabled={savingRow === deleteConfirm}
                startIcon={savingRow === deleteConfirm ? <CircularProgress size={16} /> : <DeleteIcon />}
              >
                {savingRow === deleteConfirm ? "Deleting..." : "Delete"}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      {/* Configuration Dialog */}
      <Dialog
        open={modalOpen}
        onClose={closeModal}
        maxWidth="md"
        fullWidth
        PaperProps={{ sx: { borderRadius: 2 } }}
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {interfaces.ethernet.includes(selectedIface) ? <EthernetIcon /> : <WifiIcon />}
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                Configure {selectedIface}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {interfaces.ethernet.includes(selectedIface) ? "Ethernet" : "Wi-Fi"} Interface
              </Typography>
            </Box>
          </Box>
        </DialogTitle>

        <Box component="form" onSubmit={submitConfig}>
          <DialogContent sx={{ pt: 2 }}>
            {/* Current Details */}
            <Paper sx={{ p: 2, mb: 3, bgcolor: 'grey.50' }}>
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 'bold' }}>
                Current Configuration
              </Typography>
              <Box sx={{ fontFamily: 'monospace', fontSize: '0.8rem', whiteSpace: 'pre-wrap' }}>
                {JSON.stringify(details[selectedIface] || {}, null, 2)}
              </Box>
            </Paper>

            {/* Configuration Mode */}
            <FormControl sx={{ mb: 3 }}>
              <FormLabel sx={{ fontWeight: 'bold', mb: 1 }}>Configuration Mode</FormLabel>
              <RadioGroup
                row
                value={form.mode?.toLowerCase() || "dhcp"}
                onChange={(e) => setForm((f) => ({ ...f, mode: e.target.value }))}
              >
                <FormControlLabel value="dhcp" control={<Radio />} label="DHCP" />
                <FormControlLabel value="static" control={<Radio />} label="Static" />
              </RadioGroup>
            </FormControl>

            {/* Static Configuration Fields */}
            {form.mode?.toLowerCase() === "static" && (
              <Grid container spacing={2} sx={{ mb: 3 }}>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    fullWidth
                    label="IPv4 Address"
                    value={form.ip_address || ""}
                    onChange={(e) => setForm((s) => ({ ...s, ip_address: e.target.value }))}
                    placeholder="192.168.1.100"
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    fullWidth
                    label="Netmask"
                    value={form.netmask || ""}
                    onChange={(e) => setForm((s) => ({ ...s, netmask: e.target.value }))}
                    placeholder="255.255.255.0"
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    fullWidth
                    label="Gateway"
                    value={form.gateway || ""}
                    onChange={(e) => setForm((s) => ({ ...s, gateway: e.target.value }))}
                    placeholder="192.168.1.1"
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    fullWidth
                    label="DNS Servers"
                    value={form.dns || ""}
                    onChange={(e) => setForm((s) => ({ ...s, dns: e.target.value }))}
                    placeholder="8.8.8.8,1.1.1.1"
                    helperText="Comma separated"
                  />
                </Grid>
              </Grid>
            )}

            {/* Wi-Fi Specific Fields */}
            {interfaces.wifi.includes(selectedIface) && (
              <Box sx={{ mb: 3 }}>
                <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
                  Wi-Fi Settings
                </Typography>
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <FormControl fullWidth>
                      <InputLabel>Network (SSID)</InputLabel>
                      <Select
                        value={form.ssid || ""}
                        onChange={(e) => setForm((s) => ({ ...s, ssid: e.target.value }))}
                        label="Network (SSID)"
                      >
                        <MenuItem value="">Select Network</MenuItem>
                        {(form.ssids || []).map((ssid) => (
                          <MenuItem key={ssid} value={ssid}>{ssid}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      fullWidth
                      type="password"
                      label="Password"
                      value={form.password || ""}
                      onChange={(e) => setForm((s) => ({ ...s, password: e.target.value }))}
                      placeholder="Wi-Fi Password"
                    />
                  </Grid>
                </Grid>
              </Box>
            )}

            {/* Success/Error Alerts */}
            {modalSuccess && (
              <Alert severity="success" sx={{ mb: 2 }}>
                {modalSuccess}
              </Alert>
            )}

            {modalError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {modalError}
              </Alert>
            )}
          </DialogContent>

          <DialogActions sx={{ p: 3, pt: 1 }}>
            <Button onClick={closeModal}>Cancel</Button>
            <Button
              type="submit"
              variant="contained"
              disabled={modalApplyLoading}
              startIcon={modalApplyLoading ? <CircularProgress size={16} /> : <ConfigureIcon />}
            >
              {modalApplyLoading ? "Applying..." : "Apply Configuration"}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>
    </Container>
  );
}
