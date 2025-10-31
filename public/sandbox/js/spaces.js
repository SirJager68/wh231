// ======================================================
// Warehouse 231 — Spaces Editor
// Supports: load, add/update, image upload + preview
// ======================================================

// === Load all spaces ===
// ======================================================
// Load Spaces List with Edit + Upload + Label Buttons
// ======================================================
async function loadSpaces() {
  try {
    const res = await fetch("/api/spaces");
    const spaces = await res.json();
    const list = document.getElementById("spacesList");

    if (!spaces.length) {
      list.innerHTML = `<p style="color:#666;text-align:center;margin-top:30px;">No spaces found yet.</p>`;
      return;
    }

    list.innerHTML = spaces.map(s => `
      <div class="card">
        <h3>${s.space_name}</h3>
        ${s.image_url
          ? `<img src="${s.image_url}" alt="${s.space_name}">`
          : `<p style="color:#999;">No image yet</p>`}

        <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
          <button onclick="editSpace('${s.space_name}', '${s.image_url || ""}')">✏️ Edit URL</button>
          <input type="file" id="file-${s.space_id}" accept="image/*" style="display:none" onchange="uploadImage(${s.space_id})">
          <button onclick="document.getElementById('file-${s.space_id}').click()">📤 Upload</button>
          <button onclick="openLabeler(${s.space_id}, '${s.space_name}')">🏷️ Label</button>
        </div>
      </div>
    `).join("");

  } catch (err) {
    console.error("Error loading spaces:", err);
    document.getElementById("spacesList").innerHTML = "<p style='color:red;'>Error loading spaces.</p>";
  }
}

// ======================================================
// Navigate to Labeler Page
// ======================================================
function openLabeler(spaceId, name) {
  window.location.href = `/sandbox/space-labeler.html?id=${spaceId}&name=${encodeURIComponent(name)}`;
}


// === Add or update a space manually (name + URL) ===
document.getElementById("addSpace").addEventListener("click", async () => {
  const name = document.getElementById("newSpace").value.trim();
  const url = document.getElementById("newImage").value.trim();

  if (!name) {
    alert("Please enter a room name.");
    return;
  }

  try {
    const res = await fetch("/api/spaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ space_name: name, image_url: url }),
    });

    if (res.ok) {
      alert("✅ Space saved or updated!");
      document.getElementById("newSpace").value = "";
      document.getElementById("newImage").value = "";
      loadSpaces();
    } else {
      const err = await res.json();
      alert("❌ Error: " + err.error);
    }
  } catch (err) {
    console.error("Add space error:", err);
    alert("Error saving space.");
  }
});

// === Edit space (update image URL via prompt) ===
async function editSpace(name, currentUrl) {
  const newUrl = prompt(`Enter image URL for "${name}":`, currentUrl || "");
  if (newUrl === null) return; // canceled

  try {
    const res = await fetch("/api/spaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ space_name: name, image_url: newUrl }),
    });

    const data = await res.json();
    if (res.ok) {
      alert("✅ Image URL updated!");
      loadSpaces();
    } else {
      alert("❌ Update failed: " + (data.error || "unknown"));
    }
  } catch (err) {
    console.error("Edit space error:", err);
  }
}

// === Upload image file for a space ===
async function uploadImage(spaceId) {
  const input = document.getElementById(`file-${spaceId}`);
  const file = input.files[0];
  if (!file) return;

  // Optional: preview before upload
  const reader = new FileReader();
  reader.onload = function (e) {
    const preview = document.createElement("img");
    preview.src = e.target.result;
    preview.style.maxWidth = "200px";
    preview.style.display = "block";
    preview.style.marginTop = "6px";
    alert("📸 Preview will appear in card after upload");
  };
  reader.readAsDataURL(file);

  const formData = new FormData();
  formData.append("image", file);

  try {
    const res = await fetch(`/api/spaces/${spaceId}/upload`, {
      method: "POST",
      body: formData,
    });
    const data = await res.json();

    if (res.ok) {
      alert("✅ Image uploaded successfully!");
      loadSpaces();
    } else {
      alert("❌ Upload failed: " + (data.error || ""));
    }
  } catch (err) {
    console.error("Upload error:", err);
    alert("Error uploading image.");
  }
}

// === Initialize ===
loadSpaces();
