import { useState, useEffect, useRef, useCallback } from "react";

const DB_NAME = "LuminaGallery";
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("photos")) {
        const store = db.createObjectStore("photos", { keyPath: "id" });
        store.createIndex("albumId", "albumId", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
      if (!db.objectStoreNames.contains("albums")) {
        db.createObjectStore("albums", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGet(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGetAll(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(storeName, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const req = tx.objectStore(storeName).put(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbDelete(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const req = tx.objectStore(storeName).delete(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function analyzePhotoWithClaude(base64Data, mediaType) {
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64Data }
            },
            {
              type: "text",
              text: `Analyze this photo and respond ONLY with a JSON object (no markdown, no backticks):
{
  "title": "short catchy title (max 5 words)",
  "description": "vivid 1-2 sentence description of what's in the photo",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "suggestedAlbum": "one of: Travel, Family, Nature, Food, Events, Architecture, Portrait, Pets, Sports, Art, Other",
  "mood": "one word mood/vibe of the photo"
}`
            }
          ]
        }]
      })
    });
    const data = await response.json();
    const text = data.content?.map(i => i.text || "").join("") || "";
    const clean = text.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch {
    return {
      title: "Untitled Photo",
      description: "A captured moment.",
      tags: ["photo"],
      suggestedAlbum: "Other",
      mood: "neutral"
    };
  }
}

async function searchPhotosWithAI(photos, query) {
  if (!photos.length) return [];
  try {
    const photosSummary = photos.map(p => ({
      id: p.id,
      title: p.title,
      description: p.description,
      tags: p.tags,
      album: p.albumName,
      mood: p.mood
    }));
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{
          role: "user",
          content: `Given these photos: ${JSON.stringify(photosSummary)}
          
User searched for: "${query}"

Return ONLY a JSON array of matching photo IDs (no markdown, no explanation):
["id1", "id2", ...]

Match semantically - if they search "beach" match ocean/sea/water photos too. Return empty array [] if no matches.`
        }]
      })
    });
    const data = await response.json();
    const text = data.content?.map(i => i.text || "").join("") || "[]";
    const clean = text.replace(/```json|```/g, "").trim();
    const ids = JSON.parse(clean);
    return photos.filter(p => ids.includes(p.id));
  } catch {
    return photos.filter(p =>
      p.title?.toLowerCase().includes(query.toLowerCase()) ||
      p.description?.toLowerCase().includes(query.toLowerCase()) ||
      p.tags?.some(t => t.toLowerCase().includes(query.toLowerCase()))
    );
  }
}

// ── UI Components ──────────────────────────────────────────────

function Spinner({ size = 20, color = "#6366f1" }) {
  return (
    <div style={{
      width: size, height: size, border: `2px solid #e5e7eb`,
      borderTop: `2px solid ${color}`, borderRadius: "50%",
      animation: "spin 0.8s linear infinite"
    }} />
  );
}

function PhotoCard({ photo, onClick, onDelete, onFavorite }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={() => onClick(photo)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative", borderRadius: 12, overflow: "hidden",
        cursor: "pointer", aspectRatio: "1",
        boxShadow: hovered ? "0 8px 24px rgba(0,0,0,0.18)" : "0 2px 8px rgba(0,0,0,0.08)",
        transform: hovered ? "scale(1.02)" : "scale(1)",
        transition: "all 0.2s ease",
        background: "#f3f4f6"
      }}
    >
      <img
        src={photo.dataUrl}
        alt={photo.title}
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
      {hovered && (
        <div style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 50%)",
          display: "flex", flexDirection: "column", justifyContent: "flex-end",
          padding: 10
        }}>
          <div style={{ color: "#fff", fontSize: 12, fontWeight: 600, lineHeight: 1.3 }}>
            {photo.title}
          </div>
          {photo.mood && (
            <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 10, marginTop: 2 }}>
              {photo.mood}
            </div>
          )}
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <button onClick={(e) => { e.stopPropagation(); onFavorite(photo); }}
              style={{
                background: photo.favorite ? "#ef4444" : "rgba(255,255,255,0.2)",
                border: "none", borderRadius: 6, padding: "3px 8px",
                color: "#fff", fontSize: 12, cursor: "pointer"
              }}>
              {photo.favorite ? "♥" : "♡"}
            </button>
            <button onClick={(e) => { e.stopPropagation(); onDelete(photo.id); }}
              style={{
                background: "rgba(255,255,255,0.2)", border: "none", borderRadius: 6,
                padding: "3px 8px", color: "#fff", fontSize: 12, cursor: "pointer"
              }}>
              🗑
            </button>
          </div>
        </div>
      )}
      {photo.favorite && !hovered && (
        <div style={{ position: "absolute", top: 8, right: 8, fontSize: 14 }}>♥</div>
      )}
      {photo.analyzing && (
        <div style={{
          position: "absolute", inset: 0, background: "rgba(255,255,255,0.85)",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8
        }}>
          <Spinner />
          <div style={{ fontSize: 11, color: "#6366f1", fontWeight: 600 }}>AI analyzing...</div>
        </div>
      )}
    </div>
  );
}

function PhotoModal({ photo, onClose, onDelete, onFavorite, albums, onMoveToAlbum }) {
  const [showMove, setShowMove] = useState(false);
  if (!photo) return null;
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1000, padding: 20
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "#fff", borderRadius: 20, overflow: "hidden",
        maxWidth: 860, width: "100%", maxHeight: "90vh",
        display: "flex", flexDirection: "column",
        boxShadow: "0 24px 60px rgba(0,0,0,0.4)"
      }}>
        <div style={{ display: "flex", maxHeight: "70vh" }}>
          <img src={photo.dataUrl} alt={photo.title}
            style={{ flex: "0 0 60%", objectFit: "contain", background: "#111", maxHeight: "70vh" }} />
          <div style={{ flex: 1, padding: 24, overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#111", lineHeight: 1.3 }}>
                {photo.title || "Untitled"}
              </h2>
              <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#9ca3af" }}>✕</button>
            </div>
            {photo.mood && (
              <div style={{ marginTop: 6, display: "inline-block", background: "#f3f4f6", borderRadius: 20, padding: "2px 10px", fontSize: 12, color: "#6b7280" }}>
                {photo.mood}
              </div>
            )}
            {photo.description && (
              <p style={{ marginTop: 12, fontSize: 13, color: "#4b5563", lineHeight: 1.6 }}>
                {photo.description}
              </p>
            )}
            {photo.tags?.length > 0 && (
              <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
                {photo.tags.map(tag => (
                  <span key={tag} style={{
                    background: "#ede9fe", color: "#7c3aed", borderRadius: 20,
                    padding: "2px 10px", fontSize: 11, fontWeight: 500
                  }}>{tag}</span>
                ))}
              </div>
            )}
            <div style={{ marginTop: 16, fontSize: 12, color: "#9ca3af" }}>
              {photo.albumName && <div>📁 {photo.albumName}</div>}
              <div style={{ marginTop: 4 }}>🕐 {new Date(photo.createdAt).toLocaleDateString()}</div>
              <div style={{ marginTop: 4 }}>📦 {(photo.size / 1024).toFixed(1)} KB</div>
            </div>
            <div style={{ marginTop: 20, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => onFavorite(photo)} style={{
                background: photo.favorite ? "#fee2e2" : "#f3f4f6",
                color: photo.favorite ? "#ef4444" : "#374151",
                border: "none", borderRadius: 8, padding: "7px 14px",
                fontSize: 13, cursor: "pointer", fontWeight: 500
              }}>
                {photo.favorite ? "♥ Favorited" : "♡ Favorite"}
              </button>
              <button onClick={() => setShowMove(!showMove)} style={{
                background: "#f3f4f6", color: "#374151", border: "none",
                borderRadius: 8, padding: "7px 14px", fontSize: 13, cursor: "pointer", fontWeight: 500
              }}>
                📁 Move
              </button>
              <button onClick={() => { onDelete(photo.id); onClose(); }} style={{
                background: "#fee2e2", color: "#ef4444", border: "none",
                borderRadius: 8, padding: "7px 14px", fontSize: 13, cursor: "pointer", fontWeight: 500
              }}>
                🗑 Delete
              </button>
            </div>
            {showMove && (
              <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
                {albums.map(a => (
                  <button key={a.id} onClick={() => { onMoveToAlbum(photo.id, a.id, a.name); setShowMove(false); onClose(); }}
                    style={{
                      background: photo.albumId === a.id ? "#6366f1" : "#f3f4f6",
                      color: photo.albumId === a.id ? "#fff" : "#374151",
                      border: "none", borderRadius: 8, padding: "5px 12px",
                      fontSize: 12, cursor: "pointer"
                    }}>{a.name}</button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────

export default function LuminaGallery() {
  const [tab, setTab] = useState("library");
  const [photos, setPhotos] = useState([]);
  const [albums, setAlbums] = useState([]);
  const [settings, setSettings] = useState({ name: "Alex", autoAI: true, darkMode: false });
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [selectedAlbum, setSelectedAlbum] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState("");
  const [recentSearches, setRecentSearches] = useState([]);
  const [storageUsed, setStorageUsed] = useState(0);
  const fileRef = useRef();

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    const [p, a] = await Promise.all([dbGetAll("photos"), dbGetAll("albums")]);
    setPhotos(p.sort((x, y) => y.createdAt - x.createdAt));
    setAlbums(a);
    const s = await dbGet("settings", "main");
    if (s) setSettings(s.value);
    const rs = await dbGet("settings", "recentSearches");
    if (rs) setRecentSearches(rs.value);
    calcStorage(p);
  }

  function calcStorage(p) {
    const bytes = p.reduce((acc, ph) => acc + (ph.size || 0), 0);
    setStorageUsed(bytes);
  }

  async function handleFiles(files) {
    setUploading(true);
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      const reader = new FileReader();
      const dataUrl = await new Promise(res => { reader.onload = e => res(e.target.result); reader.readAsDataURL(file); });
      const base64 = dataUrl.split(",")[1];
      const mediaType = file.type;
      const id = `photo_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const newPhoto = {
        id, dataUrl, size: file.size,
        createdAt: Date.now(), analyzing: true,
        title: file.name.replace(/\.[^.]+$/, ""),
        description: "", tags: [], albumId: null, albumName: null,
        favorite: false, mood: ""
      };
      await dbPut("photos", newPhoto);
      setPhotos(prev => [{ ...newPhoto }, ...prev]);

      if (settings.autoAI) {
        try {
          const ai = await analyzePhotoWithClaude(base64, mediaType);
          // Auto-assign to suggested album
          let albumId = null, albumName = null;
          const existing = albums.find(a => a.name === ai.suggestedAlbum);
          if (existing) {
            albumId = existing.id; albumName = existing.name;
          } else {
            const newAlb = { id: `alb_${Date.now()}`, name: ai.suggestedAlbum, createdAt: Date.now(), cover: dataUrl };
            await dbPut("albums", newAlb);
            setAlbums(prev => [...prev, newAlb]);
            albumId = newAlb.id; albumName = newAlb.name;
          }
          const updated = { ...newPhoto, ...ai, albumId, albumName, analyzing: false };
          await dbPut("photos", updated);
          setPhotos(prev => prev.map(p => p.id === id ? updated : p));
        } catch {
          const updated = { ...newPhoto, analyzing: false };
          await dbPut("photos", updated);
          setPhotos(prev => prev.map(p => p.id === id ? updated : p));
        }
      } else {
        const updated = { ...newPhoto, analyzing: false };
        await dbPut("photos", updated);
        setPhotos(prev => prev.map(p => p.id === id ? updated : p));
      }
    }
    setUploading(false);
    calcStorage(await dbGetAll("photos"));
  }

  async function deletePhoto(id) {
    await dbDelete("photos", id);
    setPhotos(prev => prev.filter(p => p.id !== id));
    calcStorage(photos.filter(p => p.id !== id));
  }

  async function toggleFavorite(photo) {
    const updated = { ...photo, favorite: !photo.favorite };
    await dbPut("photos", updated);
    setPhotos(prev => prev.map(p => p.id === photo.id ? updated : p));
    if (selectedPhoto?.id === photo.id) setSelectedPhoto(updated);
  }

  async function moveToAlbum(photoId, albumId, albumName) {
    const photo = photos.find(p => p.id === photoId);
    if (!photo) return;
    const updated = { ...photo, albumId, albumName };
    await dbPut("photos", updated);
    setPhotos(prev => prev.map(p => p.id === photoId ? updated : p));
  }

  async function createAlbum() {
    if (!newAlbumName.trim()) return;
    const alb = { id: `alb_${Date.now()}`, name: newAlbumName.trim(), createdAt: Date.now(), cover: null };
    await dbPut("albums", alb);
    setAlbums(prev => [...prev, alb]);
    setNewAlbumName("");
  }

  async function deleteAlbum(albumId) {
    await dbDelete("albums", albumId);
    setAlbums(prev => prev.filter(a => a.id !== albumId));
    const updated = photos.filter(p => p.albumId === albumId).map(p => ({ ...p, albumId: null, albumName: null }));
    for (const p of updated) await dbPut("photos", p);
    setPhotos(prev => prev.map(p => p.albumId === albumId ? { ...p, albumId: null, albumName: null } : p));
    if (selectedAlbum?.id === albumId) setSelectedAlbum(null);
  }

  async function handleSearch(q) {
    if (!q.trim()) { setSearchResults(null); return; }
    setSearching(true);
    const rs = [q, ...(recentSearches || []).filter(s => s !== q)].slice(0, 8);
    setRecentSearches(rs);
    await dbPut("settings", { key: "recentSearches", value: rs });
    const results = await searchPhotosWithAI(photos, q);
    setSearchResults(results);
    setSearching(false);
  }

  async function saveSettings(newSettings) {
    setSettings(newSettings);
    await dbPut("settings", { key: "main", value: newSettings });
  }

  const albumPhotos = selectedAlbum ? photos.filter(p => p.albumId === selectedAlbum.id) : [];
  const favoritePhotos = photos.filter(p => p.favorite);

  const styles = {
    app: {
      fontFamily: "'DM Sans', -apple-system, sans-serif",
      background: settings.darkMode ? "#0f0f0f" : "#fafafa",
      minHeight: "100vh", display: "flex", flexDirection: "column",
      maxWidth: 480, margin: "0 auto", position: "relative",
      boxShadow: "0 0 40px rgba(0,0,0,0.1)"
    },
    header: {
      background: settings.darkMode ? "#1a1a1a" : "#fff",
      borderBottom: `1px solid ${settings.darkMode ? "#2a2a2a" : "#f0f0f0"}`,
      padding: "16px 20px 12px",
      position: "sticky", top: 0, zIndex: 100
    },
    content: { flex: 1, overflowY: "auto", paddingBottom: 80 },
    nav: {
      position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)",
      width: "100%", maxWidth: 480,
      background: settings.darkMode ? "#1a1a1a" : "#fff",
      borderTop: `1px solid ${settings.darkMode ? "#2a2a2a" : "#f0f0f0"}`,
      display: "flex", padding: "8px 0 12px",
      zIndex: 100
    },
    navBtn: (active) => ({
      flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
      background: "none", border: "none", cursor: "pointer",
      color: active ? "#6366f1" : (settings.darkMode ? "#6b7280" : "#9ca3af"),
      fontSize: 10, fontWeight: active ? 700 : 500,
      transition: "color 0.15s"
    }),
    sectionTitle: {
      fontSize: 22, fontWeight: 800, color: settings.darkMode ? "#f9fafb" : "#111",
      margin: 0
    },
    card: {
      background: settings.darkMode ? "#1a1a1a" : "#fff",
      borderRadius: 16, padding: 16, marginBottom: 12,
      boxShadow: "0 1px 4px rgba(0,0,0,0.06)"
    },
    input: {
      width: "100%", padding: "10px 14px", borderRadius: 12, fontSize: 14,
      border: `1.5px solid ${settings.darkMode ? "#2a2a2a" : "#e5e7eb"}`,
      background: settings.darkMode ? "#111" : "#f9fafb",
      color: settings.darkMode ? "#f9fafb" : "#111",
      outline: "none", boxSizing: "border-box"
    },
    btn: (variant = "primary") => ({
      background: variant === "primary" ? "#6366f1" : variant === "danger" ? "#fee2e2" : "#f3f4f6",
      color: variant === "primary" ? "#fff" : variant === "danger" ? "#ef4444" : (settings.darkMode ? "#f9fafb" : "#374151"),
      border: "none", borderRadius: 10, padding: "9px 18px",
      fontSize: 13, fontWeight: 600, cursor: "pointer"
    })
  };

  // ── Library Tab ──
  function LibraryTab() {
    const [filter, setFilter] = useState("all");
    const displayed = filter === "favorites" ? favoritePhotos : photos;
    return (
      <div>
        <div style={{ padding: "16px 20px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h1 style={styles.sectionTitle}>Library</h1>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => fileRef.current.click()}
                disabled={uploading}
                style={{
                  background: "#6366f1", color: "#fff", border: "none",
                  borderRadius: 10, padding: "8px 16px", fontSize: 13,
                  fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6
                }}>
                {uploading ? <Spinner size={14} color="#fff" /> : "＋"} Add
              </button>
              <input ref={fileRef} type="file" accept="image/*" multiple
                style={{ display: "none" }} onChange={e => handleFiles(e.target.files)} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12, marginBottom: 4 }}>
            {["all", "favorites"].map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                background: filter === f ? "#6366f1" : (settings.darkMode ? "#2a2a2a" : "#f3f4f6"),
                color: filter === f ? "#fff" : (settings.darkMode ? "#d1d5db" : "#374151"),
                border: "none", borderRadius: 20, padding: "5px 14px",
                fontSize: 12, fontWeight: 600, cursor: "pointer", textTransform: "capitalize"
              }}>{f === "all" ? `All (${photos.length})` : `♥ Favorites (${favoritePhotos.length})`}</button>
            ))}
          </div>
        </div>
        {displayed.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "#9ca3af" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🖼</div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>No photos yet</div>
            <div style={{ fontSize: 13, marginTop: 6 }}>Tap + Add to upload your first photo</div>
          </div>
        ) : (
          <div style={{ padding: "12px 20px", display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>
            {displayed.map(p => (
              <PhotoCard key={p.id} photo={p} onClick={setSelectedPhoto}
                onDelete={deletePhoto} onFavorite={toggleFavorite} />
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Albums Tab ──
  function AlbumsTab() {
    if (selectedAlbum) {
      return (
        <div>
          <div style={{ padding: "16px 20px 0", display: "flex", alignItems: "center", gap: 12 }}>
            <button onClick={() => setSelectedAlbum(null)}
              style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#6366f1" }}>←</button>
            <h1 style={styles.sectionTitle}>{selectedAlbum.name}</h1>
            <button onClick={() => deleteAlbum(selectedAlbum.id)}
              style={{ marginLeft: "auto", ...styles.btn("danger") }}>Delete</button>
          </div>
          <div style={{ padding: "12px 20px" }}>
            {albumPhotos.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 0", color: "#9ca3af" }}>
                <div style={{ fontSize: 36 }}>📂</div>
                <div style={{ marginTop: 8, fontSize: 14 }}>No photos in this album yet.</div>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>
                {albumPhotos.map(p => (
                  <PhotoCard key={p.id} photo={p} onClick={setSelectedPhoto}
                    onDelete={deletePhoto} onFavorite={toggleFavorite} />
                ))}
              </div>
            )}
          </div>
        </div>
      );
    }
    return (
      <div style={{ padding: "16px 20px" }}>
        <h1 style={styles.sectionTitle}>Albums</h1>
        <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
          <input value={newAlbumName} onChange={e => setNewAlbumName(e.target.value)}
            placeholder="New album name..." style={{ ...styles.input, flex: 1 }}
            onKeyDown={e => e.key === "Enter" && createAlbum()} />
          <button onClick={createAlbum} style={styles.btn("primary")}>Create</button>
        </div>
        {albums.length === 0 ? (
          <div style={{ textAlign: "center", padding: "50px 0", color: "#9ca3af" }}>
            <div style={{ fontSize: 40 }}>🗂</div>
            <div style={{ marginTop: 8, fontSize: 14 }}>No albums yet. AI auto-creates albums when you upload photos.</div>
          </div>
        ) : (
          <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {albums.map(a => {
              const count = photos.filter(p => p.albumId === a.id).length;
              const cover = photos.find(p => p.albumId === a.id)?.dataUrl;
              return (
                <div key={a.id} onClick={() => setSelectedAlbum(a)} style={{
                  borderRadius: 14, overflow: "hidden", cursor: "pointer",
                  background: settings.darkMode ? "#1a1a1a" : "#f3f4f6",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                  transition: "transform 0.15s",
                }}>
                  <div style={{
                    height: 100, background: cover ? `url(${cover}) center/cover` : "linear-gradient(135deg,#a5b4fc,#818cf8)",
                    position: "relative"
                  }}>
                    {!cover && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32 }}>📁</div>}
                  </div>
                  <div style={{ padding: "10px 12px" }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: settings.darkMode ? "#f9fafb" : "#111" }}>{a.name}</div>
                    <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>{count} photo{count !== 1 ? "s" : ""}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── Search Tab ──
  function SearchTab() {
    const [q, setQ] = useState(searchQuery);
    return (
      <div style={{ padding: "16px 20px" }}>
        <h1 style={styles.sectionTitle}>Search</h1>
        <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
          <input
            value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search photos, people, places..."
            style={{ ...styles.input, flex: 1 }}
            onKeyDown={e => { if (e.key === "Enter") { setSearchQuery(q); handleSearch(q); } }}
          />
          <button onClick={() => { setSearchQuery(q); handleSearch(q); }} style={styles.btn("primary")}>
            {searching ? <Spinner size={14} color="#fff" /> : "🔍"}
          </button>
        </div>
        <div style={{ marginTop: 6, fontSize: 11, color: "#9ca3af" }}>✨ AI-powered semantic search</div>

        {!searchResults && !searching && (
          <>
            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", letterSpacing: 1, marginBottom: 10 }}>SUGGESTED CATEGORIES</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {[
                  { icon: "🌍", label: "Travel", color: "#dbeafe" },
                  { icon: "👨‍👩‍👧", label: "Family", color: "#dcfce7" },
                  { icon: "⭐", label: "Favorites", color: "#fef9c3" },
                  { icon: "🎬", label: "Videos", color: "#f3e8ff" }
                ].map(c => (
                  <button key={c.label} onClick={() => { setQ(c.label); setSearchQuery(c.label); handleSearch(c.label); }}
                    style={{
                      background: c.color, border: "none", borderRadius: 14, padding: "14px 12px",
                      display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
                      fontSize: 14, fontWeight: 600, color: "#374151"
                    }}>
                    <span style={{ fontSize: 22 }}>{c.icon}</span> {c.label}
                  </button>
                ))}
              </div>
            </div>
            {recentSearches?.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", letterSpacing: 1 }}>RECENT SEARCHES</div>
                  <button onClick={async () => { setRecentSearches([]); await dbDelete("settings", "recentSearches"); }}
                    style={{ background: "none", border: "none", fontSize: 12, color: "#6366f1", cursor: "pointer", fontWeight: 600 }}>
                    Clear All
                  </button>
                </div>
                {recentSearches.map(s => (
                  <div key={s} onClick={() => { setQ(s); setSearchQuery(s); handleSearch(s); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 12, padding: "10px 0",
                      borderBottom: `1px solid ${settings.darkMode ? "#2a2a2a" : "#f3f4f6"}`,
                      cursor: "pointer", color: settings.darkMode ? "#d1d5db" : "#374151"
                    }}>
                    <span style={{ color: "#9ca3af" }}>🕐</span>
                    <span style={{ fontSize: 14 }}>{s}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {searching && (
          <div style={{ textAlign: "center", padding: "40px 0", color: "#9ca3af" }}>
            <Spinner size={32} />
            <div style={{ marginTop: 12, fontSize: 14 }}>AI is searching...</div>
          </div>
        )}

        {searchResults && !searching && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: settings.darkMode ? "#d1d5db" : "#374151" }}>
                {searchResults.length} result{searchResults.length !== 1 ? "s" : ""} for "{searchQuery}"
              </div>
              <button onClick={() => { setSearchResults(null); setQ(""); setSearchQuery(""); }}
                style={{ background: "none", border: "none", color: "#6366f1", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>Clear</button>
            </div>
            {searchResults.length === 0 ? (
              <div style={{ textAlign: "center", padding: "30px 0", color: "#9ca3af" }}>
                <div style={{ fontSize: 36 }}>🔍</div>
                <div style={{ marginTop: 8 }}>No photos found</div>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>
                {searchResults.map(p => (
                  <PhotoCard key={p.id} photo={p} onClick={setSelectedPhoto}
                    onDelete={deletePhoto} onFavorite={toggleFavorite} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Settings Tab ──
  function SettingsTab() {
    const [localSettings, setLocalSettings] = useState(settings);
    const usedMB = (storageUsed / 1024 / 1024).toFixed(1);
    const row = (label, value) => (
      <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${settings.darkMode ? "#2a2a2a" : "#f3f4f6"}`, fontSize: 14 }}>
        <span style={{ color: settings.darkMode ? "#d1d5db" : "#374151" }}>{label}</span>
        <span style={{ color: "#6366f1", fontWeight: 600 }}>{value}</span>
      </div>
    );
    return (
      <div style={{ padding: "16px 20px" }}>
        <h1 style={styles.sectionTitle}>Settings</h1>

        <div style={{ ...styles.card, marginTop: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#9ca3af", letterSpacing: 1, marginBottom: 12 }}>ACCOUNT</div>
          <input value={localSettings.name} onChange={e => setLocalSettings({ ...localSettings, name: e.target.value })}
            placeholder="Your name" style={styles.input} />
          <button onClick={() => saveSettings(localSettings)} style={{ ...styles.btn("primary"), marginTop: 10 }}>Save</button>
        </div>

        <div style={{ ...styles.card }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#9ca3af", letterSpacing: 1, marginBottom: 12 }}>STORAGE</div>
          <div style={{ background: settings.darkMode ? "#111" : "#f3f4f6", borderRadius: 8, height: 8, marginBottom: 8 }}>
            <div style={{ background: "#6366f1", borderRadius: 8, height: 8, width: `${Math.min((storageUsed / (500 * 1024 * 1024)) * 100, 100)}%` }} />
          </div>
          {row("Used", `${usedMB} MB`)}
          {row("Photos", `${photos.length}`)}
          {row("Albums", `${albums.length}`)}
        </div>

        <div style={{ ...styles.card }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#9ca3af", letterSpacing: 1, marginBottom: 12 }}>AI FEATURES</div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0" }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: settings.darkMode ? "#f9fafb" : "#111" }}>Auto AI Analysis</div>
              <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>Auto-describe & categorize on upload</div>
            </div>
            <div onClick={() => { const s = { ...settings, autoAI: !settings.autoAI }; saveSettings(s); }}
              style={{
                width: 44, height: 24, borderRadius: 12, cursor: "pointer",
                background: settings.autoAI ? "#6366f1" : "#d1d5db",
                position: "relative", transition: "background 0.2s"
              }}>
              <div style={{
                position: "absolute", width: 18, height: 18, borderRadius: "50%",
                background: "#fff", top: 3, left: settings.autoAI ? 23 : 3,
                transition: "left 0.2s", boxShadow: "0 1px 4px rgba(0,0,0,0.2)"
              }} />
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0" }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: settings.darkMode ? "#f9fafb" : "#111" }}>Dark Mode</div>
            </div>
            <div onClick={() => { const s = { ...settings, darkMode: !settings.darkMode }; saveSettings(s); }}
              style={{
                width: 44, height: 24, borderRadius: 12, cursor: "pointer",
                background: settings.darkMode ? "#6366f1" : "#d1d5db",
                position: "relative", transition: "background 0.2s"
              }}>
              <div style={{
                position: "absolute", width: 18, height: 18, borderRadius: "50%",
                background: "#fff", top: 3, left: settings.darkMode ? 23 : 3,
                transition: "left 0.2s", boxShadow: "0 1px 4px rgba(0,0,0,0.2)"
              }} />
            </div>
          </div>
        </div>

        <div style={{ ...styles.card }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#9ca3af", letterSpacing: 1, marginBottom: 12 }}>DANGER ZONE</div>
          <button onClick={async () => {
            if (!confirm("Delete ALL photos and albums? This cannot be undone.")) return;
            const db = await openDB();
            db.transaction(["photos", "albums"], "readwrite").objectStore("photos").clear();
            db.transaction(["photos", "albums"], "readwrite").objectStore("albums").clear();
            setPhotos([]); setAlbums([]); setStorageUsed(0);
          }} style={{ ...styles.btn("danger"), width: "100%" }}>
            🗑 Delete All Photos & Albums
          </button>
        </div>
      </div>
    );
  }

  const navItems = [
    { id: "library", icon: "🖼", label: "Library" },
    { id: "albums", icon: "🗂", label: "Albums" },
    { id: "search", icon: "🔍", label: "Search" },
    { id: "settings", icon: "⚙️", label: "Settings" },
  ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 4px; }
        body { margin: 0; }
      `}</style>
      <div style={styles.app}>
        <div style={styles.content}>
          {tab === "library" && <LibraryTab />}
          {tab === "albums" && <AlbumsTab />}
          {tab === "search" && <SearchTab />}
          {tab === "settings" && <SettingsTab />}
        </div>
        <nav style={styles.nav}>
          {navItems.map(item => (
            <button key={item.id} onClick={() => setTab(item.id)} style={styles.navBtn(tab === item.id)}>
              <span style={{ fontSize: 20 }}>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <PhotoModal
          photo={selectedPhoto} onClose={() => setSelectedPhoto(null)}
          onDelete={deletePhoto} onFavorite={toggleFavorite}
          albums={albums} onMoveToAlbum={moveToAlbum}
        />
      </div>
    </>
  );
}
