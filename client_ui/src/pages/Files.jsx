import { useEffect, useState, useRef } from "react";
import axios from "axios";
import { API_BASE, checkToken } from "../common";

export default function Files() {
  const [currentPath, setCurrentPath] = useState("/");
  const [entries, setEntries] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [processingProgress, setProcessingProgress] = useState(0);
  const fileInputRef = useRef(null);

  const AUTH_HEADER = {
    Authorization: `Bearer ${localStorage.getItem("token")}`,
  };

  const fetchDirectory = async (path) => {
    try {
      const res = await axios.get(`${API_BASE}/files/list`, {
        params: { path },
        headers: AUTH_HEADER,
      });
      setEntries(res.data);
      setCurrentPath(path);
      setSelectedIndex(null);
    } catch (err) {
      console.error("Failed to fetch directory:", err);
    }
  };

  useEffect(() => {
    checkToken();
    fetchDirectory("/");
  }, []);

  const formatSize = (bytes) => {
    if (bytes == null) return "-";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (epochSeconds) => {
    if (!epochSeconds) return "-";
    const d = new Date(epochSeconds * 1000);
    const pad = (n) => n.toString().padStart(2, "0");
    const year = d.getFullYear();
    const month = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    const hours = pad(d.getHours());
    const minutes = pad(d.getMinutes());
    const seconds = pad(d.getSeconds());
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  };

  const handleBack = () => {
    if (currentPath === "/") return;
    const parent =
      currentPath.replace(/\/+$/, "").split("/").slice(0, -1).join("/") || "/";
    fetchDirectory(parent);
  };

  const handleDoubleClick = (entry) => {
    const fullPath = `${currentPath}/${entry.name}`.replace(/\/+/g, "/");
    if (entry.is_dir) {
      fetchDirectory(fullPath);
    } else {
      window.location.href = `${API_BASE}/files/download?path=${encodeURIComponent(
        fullPath
      )}`;
    }
  };

  const handleDownload = async () => {
    if (selectedIndex === null) return;

    const entry = entries[selectedIndex];
    const fullPath = `${currentPath}/${entry.name}`.replace(/\/+/g, "/");

    try {
        const response = await fetch(
        `${API_BASE}/files/download-url?path=${encodeURIComponent(fullPath)}`,
        {
            headers: AUTH_HEADER,
        }
        );

        if (!response.ok) {
        throw new Error("Failed to get signed URL");
        }

        const { url } = await response.json();

        // Option 1: Open in same tab
        window.location.href = API_BASE + url;

        // Option 2: Open in new tab (if you want)
        // window.open(url, "_blank");
    } catch (err) {
        console.error("Download failed:", err);
    }
  };

  const handleRename = async () => {
    if (selectedIndex === null) return;
    const entry = entries[selectedIndex];
    const oldPath = `${currentPath}/${entry.name}`.replace(/\/+/g, "/");
    const newName = prompt("Enter new name", entry.name);
    if (!newName || newName === entry.name) return;

    const newPath = `${currentPath}/${newName}`.replace(/\/+/g, "/");
    const formData = new FormData();
    formData.append("oldPath", oldPath);
    formData.append("newPath", newPath);

    try {
      await axios.post(`${API_BASE}/files/rename`, formData, {
        headers: {
          ...AUTH_HEADER,
          "Content-Type": "multipart/form-data",
        },
      });
      fetchDirectory(currentPath);
    } catch (err) {
      alert("Rename failed: " + err.message);
    }
  };

  const handleDelete = async () => {
    if (selectedIndex === null) return;
    const entry = entries[selectedIndex];
    const fullPath = `${currentPath}/${entry.name}`.replace(/\/+/g, "/");

    if (!window.confirm(`Delete "${entry.name}"?`)) return;

    try {
      await axios.post(`${API_BASE}/files/delete?path=${encodeURIComponent(fullPath)}`, null, {
        headers: {
          ...AUTH_HEADER,
          "Content-Type": "multipart/form-data",
        },
      });

      fetchDirectory(currentPath);
    } catch (err) {
      alert("Delete failed: " + err.message);
    }
  };

  // Upload handling
  const handleUploadClick = () => {
    if (fileInputRef.current) fileInputRef.current.click();
  };

  const handleFileSelected = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const uploadId = `${file.name}-${Date.now()}`;
    const formData = new FormData();
    formData.append("upload", file);

    try {
        setUploadProgress(0);
        setProcessingProgress(0);

        const pollInterval = setInterval(async () => {
            try {
                const progressRes = await axios.get(
                    `${API_BASE}/files/upload-progress`,
                    {
                        params: { upload_id: uploadId },
                        headers: {
                            ...AUTH_HEADER,
                            "Content-Type": "multipart/form-data",
                        },
                    }
                );
                const progress = progressRes.data.progress || 0;
                setProcessingProgress(progress);
                if (progress >= 100) {
                    clearInterval(pollInterval);
                    fetchDirectory(currentPath);
                    setUploadProgress(0);
                    setProcessingProgress(0);
                }
            } catch (e) {
                clearInterval(pollInterval);
                setProcessingProgress(0);
                console.error("Error polling processing progress:", e);
            }
        }, 1000);

        axios.post(
            `${API_BASE}/files/upload?path=${encodeURIComponent(currentPath)}&upload_id=${encodeURIComponent(uploadId)}`,
            formData,
            {
                headers: {
                    ...AUTH_HEADER,
                    "Content-Type": "multipart/form-data",
                },
                onUploadProgress: (progressEvent) => {
                    if (progressEvent.total) {
                        const percentCompleted = Math.round(
                            (progressEvent.loaded * 100) / progressEvent.total
                        );
                        setUploadProgress(percentCompleted);
                    }
                },
            }
        );

    } catch (err) {
        alert("Upload failed: " + err.message);
    } finally {
        event.target.value = null;
    }
  };

  // New folder creation
  const handleNewFolder = async () => {
    const folderName = prompt("Enter new folder name");
    if (!folderName) return;
    const formData = new FormData();
    formData.append("newPath", `${currentPath}/${folderName}`.replace(/\/+/g, "/"));

    try {
      await axios.post(`${API_BASE}/files/new_folder`, formData, {
        headers: {
          ...AUTH_HEADER,
          "Content-Type": "multipart/form-data",
        },
      });
      fetchDirectory(currentPath);
    } catch (err) {
      alert("Create folder failed: " + err.message);
    }
  };

  // New file creation
  const handleNewFile = async () => {
    const fileName = prompt("Enter new file name");
    if (!fileName) return;
    const formData = new FormData();
    formData.append("newPath", `${currentPath}/${fileName}`.replace(/\/+/g, "/"));

    try {
      await axios.post(`${API_BASE}/files/new_file`, formData, {
        headers: {
          ...AUTH_HEADER,
          "Content-Type": "multipart/form-data",
        },
      });
      fetchDirectory(currentPath);
    } catch (err) {
      alert("Create file failed: " + err.message);
    }
  };

  return (
    <div style={{ padding: "1rem", fontFamily: "sans-serif" }}>
      {/* Top: Back + Path */}
      <div style={{ marginBottom: "1rem", display: "flex", alignItems: "center" }}>
        <button onClick={handleBack} disabled={currentPath === "/"}>
          ⬅ Back
        </button>
        <span style={{ marginLeft: "1rem", fontWeight: "bold" }}>{currentPath}</span>
      </div>

      {/* Header row */}
      <div
        style={{
          display: "flex",
          padding: "0.5rem",
          borderBottom: "2px solid #aaa",
          fontWeight: "bold",
          color: "#444",
          userSelect: "none",
        }}
      >
        <div style={{ width: "2rem" }}></div>
        <div style={{ flex: 1 }}>Name</div>
        <div style={{ width: "16rem", textAlign: "right" }}>Last Modified</div>
        <div style={{ width: "10rem", textAlign: "right" }}>Size</div>
      </div>

      {/* File entries */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          border: "1px solid #ccc",
          maxHeight: "70vh",
          overflowY: "auto",
        }}
      >
        {entries.map((entry, idx) => {
          const isSelected = selectedIndex === idx;
          return (
            <div
              key={idx}
              onClick={() => setSelectedIndex(idx)}
              onDoubleClick={() => handleDoubleClick(entry)}
              style={{
                display: "flex",
                padding: "0.5rem",
                backgroundColor: isSelected ? "#e0f0ff" : "white",
                borderBottom: "1px solid #eee",
                cursor: "pointer",
                alignItems: "center",
              }}
            >
              <span style={{ width: "2rem" }}>{entry.is_dir ? "📁" : "📄"}</span>
              <span style={{ flex: 1 }}>{entry.name}</span>
              <span style={{ width: "16rem", textAlign: "right" }}>
                {formatDate(entry.mtime)}
              </span>
              <span style={{ width: "10rem", textAlign: "right" }}>
                {entry.is_dir ? "-" : formatSize(entry.size)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Action buttons below */}
      <div style={{ marginTop: "1rem", display: "flex", gap: "12px", flexWrap: "wrap" }}>
        <button onClick={handleNewFolder} title="New Folder" style={{ fontSize: "1rem" }}>
          📁➕ New Folder
        </button>
        <button onClick={handleNewFile} title="New File" style={{ fontSize: "1rem" }}>
          📄➕ New File
        </button>
        <button onClick={handleUploadClick} title="Upload File" style={{ fontSize: "1rem" }}>
          📤 Upload
        </button>
        <button
          onClick={handleDownload}
          disabled={selectedIndex === null}
          title="Download Selected"
          style={{ fontSize: "1rem" }}
        >
          📥 Download
        </button>
        <button
          onClick={handleRename}
          disabled={selectedIndex === null}
          title="Rename Selected"
          style={{ fontSize: "1rem" }}
        >
          ✏️ Rename
        </button>
        <button
          onClick={handleDelete}
          disabled={selectedIndex === null}
          title="Delete Selected"
          style={{ fontSize: "1rem" }}
        >
          🗑️ Delete
        </button>
      </div>

      {uploadProgress > 0 && (
        <div
            style={{
            display: "flex",
            alignItems: "center",
            margin: "1rem 0",
            gap: "0.5rem",
            }}
            aria-label="Upload progress"
            role="progressbar"
            aria-valuenow={uploadProgress}
            aria-valuemin={0}
            aria-valuemax={100}
        >
            {/* Label */}
                <div style={{ fontWeight: "bold", minWidth: "80px", textAlign: "right" }}>
                Uploading:
            </div>

            {/* Progress percent number */}
            <div style={{ minWidth: "30px", textAlign: "right", fontWeight: "bold" }}>
                {uploadProgress}%
            </div>

            {/* Progress bar */}
            <div
                style={{
                    flex: 1,
                    height: "8px",
                    backgroundColor: "#eee",
                    borderRadius: "4px",
                    overflow: "hidden",
                }}
            >
            <div
                style={{
                    width: `${uploadProgress}%`,
                    height: "100%",
                    backgroundColor: "#4caf50",
                    transition: "width 0.3s ease",
                    }}
            />
            </div>
        </div>
      )}

      {processingProgress > 0 && (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                margin: "0.5rem 0",
                gap: "0.5rem",
            }}
            aria-label="Server processing progress"
            role="progressbar"
            aria-valuenow={processingProgress}
            aria-valuemin={0}
            aria-valuemax={100}
        >
            <div style={{ fontWeight: "bold", minWidth: "80px", textAlign: "right" }}>
                Processing:
            </div>

            <div style={{ minWidth: "30px", textAlign: "right", fontWeight: "bold" }}>
                {processingProgress}%
            </div>

            <div
                style={{
                    flex: 1,
                    height: "8px",
                    backgroundColor: "#eee",
                    borderRadius: "4px",
                    overflow: "hidden",
                }}
            >
            <div
                style={{
                    width: `${processingProgress}%`,
                    height: "100%",
                    backgroundColor: "#2196f3",
                    transition: "width 0.3s ease",
                    }}
            />
            </div>
        </div>
      )}

      {/* Hidden file input for upload */}
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: "none" }}
        onChange={handleFileSelected}
      />
    </div>
  );
}
