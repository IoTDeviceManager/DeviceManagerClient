import { useEffect, useState } from "react";
import axios from "axios";
import { API_BASE, checkToken } from "../common";
import {
  Container,
  Typography,
  Card,
  CardContent,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
  Alert,
  Box,
  IconButton,
  Chip,
  Grid,
  Divider
} from "@mui/material";
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  AdminPanelSettings as AdminIcon,
  AccountCircle as UserIcon
} from "@mui/icons-material";

export default function Users() {
  const AUTH_HEADER = {
    Authorization: `Bearer ${localStorage.getItem("token")}`,
  };

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [form, setForm] = useState({ username: "", password: "", role: "common" });
  const [error, setError] = useState(null);

  const [editUser, setEditUser] = useState(null);
  const [editForm, setEditForm] = useState({ username: "", role: "common", password: "" });

  const openEditModal = (user) => {
    setEditUser(user);
    setEditForm({ username: user.username, role: user.role, password: "" });
  };

  const closeEditModal = () => {
    setEditUser(null);
    setEditForm({ username: "", role: "common", password: "" });
  };

  const handleEditChange = (e) => {
    setEditForm({ ...editForm, [e.target.name]: e.target.value });
  };

  const submitEdit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await axios.put(
        `${API_BASE}/users/users/${encodeURIComponent(editUser.username)}`,
        new URLSearchParams(editForm),
        { headers: { ...AUTH_HEADER, "Content-Type": "application/x-www-form-urlencoded" } }
      );
      fetchUsers();
      closeEditModal();
    } catch (error) {
      if (error.response?.data?.detail) {
        setError(`Failed to update user: ${error.response.data.detail}`);
      } else {
        setError("Failed to update user");
      }
    }
  };

  const deleteUser = async (username) => {
    if (!window.confirm(`Are you sure you want to delete user "${username}"?`)) return;

    try {
      await axios.delete(`${API_BASE}/users/users/${encodeURIComponent(username)}`, {
        headers: AUTH_HEADER,
      });
      fetchUsers(); // Refresh after delete
    } catch (error) {
      if (error.response && error.response.data && error.response.data.detail) {
        setError(`Failed to delete user: ${error.response.data.detail}`);
      } else {
        setError(`Failed to delete user: ${username}`);
      }
    }
  };

  useEffect(() => {
    checkToken();
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/users/users`, {
        headers: AUTH_HEADER,
      });
      setUsers(res.data);
      setLoading(false);
    } catch (err) {
      setError("Failed to fetch users");
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await axios.post(
        `${API_BASE}/users/users`,
        new URLSearchParams(form),
        { headers: { ...AUTH_HEADER, "Content-Type": "application/x-www-form-urlencoded" } }
      );
      setForm({ username: "", password: "", role: "common" });
      fetchUsers();
    } catch (error) {
      if (error.response && error.response.data && error.response.data.detail) {
        setError(`Failed to create user: ${error.response.data.detail}`);
      } else {
        setError("Failed to create user");
      }
    }
  };

  const getRoleIcon = (role) => {
    return role === 'admin' ? <AdminIcon fontSize="small" /> : <UserIcon fontSize="small" />;
  };

  const getRoleColor = (role) => {
    return role === 'admin' ? 'error' : 'primary';
  };

  return (
    <Container maxWidth="lg" sx={{ py: 4, display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: 'calc(100vh - 4rem)' }}>

      {/* Create User Form */}
      <Card sx={{ mb: 4, boxShadow: 3 }}>
        <CardContent sx={{ p: 3 }}>
          <Typography variant="h5" sx={{ mb: 3, fontWeight: 'medium', color: 'text.primary' }}>
            Create New User
          </Typography>
          <Divider sx={{ mb: 3 }} />
          
          <Box component="form" onSubmit={handleSubmit}>
            <Grid container spacing={3} alignItems="flex-end">
              <Grid item xs={12} sm={6} md={3}>
                <TextField
                  fullWidth
                  label="Username"
                  name="username"
                  type="text"
                  value={form.username}
                  onChange={handleChange}
                  required
                  variant="outlined"
                  size="medium"
                />
              </Grid>
              
              <Grid item xs={12} sm={6} md={3}>
                <TextField
                  fullWidth
                  label="Password"
                  name="password"
                  type="password"
                  value={form.password}
                  onChange={handleChange}
                  required
                  variant="outlined"
                  size="medium"
                />
              </Grid>
              
              <Grid item xs={12} sm={6} md={2}>
                <FormControl fullWidth variant="outlined" size="medium">
                  <InputLabel>Role</InputLabel>
                  <Select
                    name="role"
                    value={form.role}
                    onChange={handleChange}
                    label="Role"
                  >
                    <MenuItem value="admin">Admin</MenuItem>
                    <MenuItem value="common">Common</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              
              <Grid item xs={12} sm={6} md={2}>
                <Button
                  type="submit"
                  variant="contained"
                  size="large"
                  startIcon={<AddIcon />}
                  fullWidth
                  sx={{ 
                    py: 1.8,
                    fontSize: '1rem',
                    fontWeight: 'medium'
                  }}
                >
                  Create User
                </Button>
              </Grid>
            </Grid>
          </Box>
        </CardContent>
      </Card>

      {/* Users Table */}
      <Card sx={{ boxShadow: 3 }}>
        <CardContent sx={{ p: 0 }}>
          <Box sx={{ p: 3, pb: 0 }}>
            <Typography variant="h5" sx={{ fontWeight: 'medium', color: 'text.primary' }}>
              Users ({users.length})
            </Typography>
          </Box>
          
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
              <CircularProgress size={40} />
            </Box>
          ) : (
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow sx={{ bgcolor: 'grey.50' }}>
                    <TableCell sx={{ fontWeight: 'bold', fontSize: '1rem' }}>Username</TableCell>
                    <TableCell sx={{ fontWeight: 'bold', fontSize: '1rem' }}>Role</TableCell>
                    <TableCell sx={{ fontWeight: 'bold', fontSize: '1rem' }} align="center">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {users.map((user) => (
                    <TableRow 
                      key={user.username}
                      sx={{ 
                        '&:hover': { bgcolor: 'action.hover' },
                        '&:last-child td, &:last-child th': { border: 0 }
                      }}
                    >
                      <TableCell sx={{ fontSize: '0.95rem' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          {getRoleIcon(user.role)}
                          {user.username}
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={user.role}
                          color={getRoleColor(user.role)}
                          variant="outlined"
                          size="small"
                          sx={{ textTransform: 'capitalize', fontWeight: 'medium' }}
                        />
                      </TableCell>
                      <TableCell align="center">
                        <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center' }}>
                          <IconButton
                            onClick={() => openEditModal(user)}
                            color="primary"
                            size="small"
                            sx={{ 
                              '&:hover': { bgcolor: 'primary.50' }
                            }}
                          >
                            <EditIcon fontSize="small" />
                          </IconButton>
                          <IconButton
                            onClick={() => deleteUser(user.username)}
                            color="error"
                            size="small"
                            sx={{ 
                              '&:hover': { bgcolor: 'error.50' }
                            }}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Box>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      {/* Edit User Dialog */}
      <Dialog 
        open={Boolean(editUser)} 
        onClose={closeEditModal}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: { borderRadius: 2 }
        }}
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <EditIcon color="primary" />
            Edit User
          </Box>
        </DialogTitle>
        
        <Box component="form" onSubmit={submitEdit}>
          <DialogContent sx={{ pt: 2 }}>
            <Grid container spacing={3}>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Username"
                  name="username"
                  value={editForm.username}
                  disabled
                  variant="outlined"
                  helperText="Username cannot be changed"
                />
              </Grid>
              
              <Grid item xs={12}>
                <FormControl fullWidth variant="outlined">
                  <InputLabel>Role</InputLabel>
                  <Select
                    name="role"
                    value={editForm.role}
                    onChange={handleEditChange}
                    label="Role"
                  >
                    <MenuItem value="admin">Admin</MenuItem>
                    <MenuItem value="common">Common</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="New Password"
                  name="password"
                  type="password"
                  value={editForm.password}
                  onChange={handleEditChange}
                  variant="outlined"
                  helperText="Leave blank to keep current password"
                />
              </Grid>
            </Grid>
          </DialogContent>
          
          <DialogActions sx={{ p: 3, pt: 2 }}>
            <Button onClick={closeEditModal} color="inherit">
              Cancel
            </Button>
            <Button 
              type="submit" 
              variant="contained"
              startIcon={<EditIcon />}
              sx={{ ml: 1 }}
            >
              Save Changes
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      {/* Error Alert */}
      {error && (
        <Alert 
          severity="error" 
          sx={{ mt: 2 }}
          onClose={() => setError(null)}
        >
          {error}
        </Alert>
      )}
    </Container>
  );
}
