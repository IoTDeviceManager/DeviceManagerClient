import axios from "axios";
export const API_BASE = `${window.location.protocol}//${window.location.hostname}:15000/api`;

export const checkToken = () => {
  const AUTH_HEADER = {
    Authorization: `Bearer ${localStorage.getItem("token")}`,
  };
  axios.get(`${API_BASE}/users/check_token`, {
    headers: {
      ...AUTH_HEADER,
      "Content-Type": "multipart/form-data",
    }
  })
  .then(res => {
    // Token is valid, do nothing
  })
  .catch(err => {
    if (err.response && err.response.status === 401) {
      localStorage.removeItem("token");
      window.location.href = "/login";
    }
  });
};
