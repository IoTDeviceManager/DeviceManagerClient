import { NavLink, Navigate, Routes, Route, useNavigate } from "react-router-dom";
import Main from "./pages/Main";
import Network from "./pages/Network";
import Update from "./pages/Update";
import Terminal from "./pages/Terminal";
import Files from "./pages/Files";
import Users from "./pages/Users";
import "./MainLayout.css";

export default function MainLayout() {
  const navigate = useNavigate();
  const role = localStorage.getItem("role");
  const token = localStorage.getItem("token");

  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("role");
    navigate("/login");
  };

  return (
    <div className="layout">
      <nav className="sidebar">
        <h2>IoT Manager</h2>
        <ul>
          <li><NavLink to="/main">Main</NavLink></li>
          <li><NavLink to="/network">Network</NavLink></li>
          <li><NavLink to="/update">Update</NavLink></li>
          {role === "admin" && (
            <>
              <li><NavLink to="/users">Users</NavLink></li>
              <li><NavLink to="/files">Files</NavLink></li>
              <li><NavLink to="/terminal">Terminal</NavLink></li>
            </>
          )}
        </ul>
        <button onClick={logout}>Logout</button>
      </nav>
      <main className="content">
        <Routes>
          <Route path="/" element={token ? <Navigate to="/main" /> : <Navigate to="/login" />} />
          <Route path="/main" element={<Main />} />
          <Route path="/network" element={<Network />} />
          <Route path="/update" element={<Update />} />
          {role === "admin" && (
            <>
              <Route path="/users" element={<Users />} />
              <Route path="/files" element={<Files />} />
              <Route path="/terminal" element={<Terminal />} />
            </>
          )}
        </Routes>
      </main>
    </div>
  );
}
