const params = new URLSearchParams(window.location.search);
const line = params.get('line');
let currentItem = null;
let editField = null;

// === Load item and edits ===
async function loadItem() {
    try {
        const res = await fetch(`/api/items/${line}/compare`);
        const data = await res.json();
        const { item, edits } = data;
        currentItem = item;
        const el = document.getElementById('item');

        el.innerHTML = `
      <h2>Item #${item.line_number}</h2>
      <table class="compare-table">
        <thead><tr><th>Field</th><th>Original</th><th>Edited</th><th></th></tr></thead>
        <tbody>
          ${renderRow("room_area", "Room / Area", item.room_area, edits.room_area)}
          ${renderRow("quantity", "Quantity", item.quantity, edits.quantity)}
          ${renderRow("description", "Description", item.description, edits.description)}
          ${renderRow("brand", "Brand", item.brand, edits.brand)}
          ${renderRow("model", "Model", item.model, edits.model)}
          ${renderRow("unit_rcv", "Unit RCV", formatMoney(item.unit_rcv), edits.unit_rcv)}
          ${renderRow("extended_rcv", "Extended RCV", formatMoney(item.extended_rcv), edits.extended_rcv)}
          ${renderRow("acv_percent", "ACV %", item.acv_percent, edits.acv_percent)}
          ${renderRow("acv", "ACV", formatMoney(item.acv), edits.acv)}
          ${renderRow("notes", "Notes", item.notes, edits.notes)}
          ${renderRow("source_link", "Source", item.source_link ? `<a href='${item.source_link}' target='_blank'>View</a>` : "N/A", edits.source_link)}
        </tbody>
      </table>
    `;

        await loadHistory();
    } catch (err) {
        console.error("Error loading item:", err);
        document.getElementById('item').innerHTML = "<p>Error loading item details.</p>";
    }
}

// === Load edit history ===
async function loadHistory() {
    const res = await fetch(`/api/items/${line}/edits`);
    const edits = await res.json();
    const tbody = document.getElementById('historyBody');
    if (!edits.length) {
        tbody.innerHTML = "<tr><td colspan='5' style='text-align:center;color:#999;'>No edits yet.</td></tr>";
        return;
    }
    tbody.innerHTML = edits.map(e => `
    <tr>
      <td>${new Date(e.edited_at).toLocaleString()}</td>
      <td>${e.field_name}</td>
      <td>${e.old_value || ""}</td>
      <td>${e.new_value || ""}</td>
      <td>${e.edited_by}</td>
    </tr>
  `).join("");
}

function renderRow(field, label, value, edit) {
  // define which fields are read-only
  const readOnlyFields = ["extended_rcv"];

  const editedHTML = edit ? `
    <div class="edited">
      ${edit.new_value || ""}
      <small>(${edit.edited_by || "user"}, ${new Date(edit.edited_at).toLocaleDateString()})</small>
    </div>` : `<span style="color:#999;">–</span>`;

  // show Locked instead of Edit button
  const editCell = readOnlyFields.includes(field)
    ? `<span style="color:#999;">Locked</span>`
    : `<button class="edit-btn" onclick="openModal('${field}','${value ?? ''}')">Edit</button>`;

  return `
    <tr>
      <td><b>${label}</b></td>
      <td>${value ?? ""}</td>
      <td>${editedHTML}</td>
      <td>${editCell}</td>
    </tr>`;
}


function openModal(field, value) {
    editField = field;
    document.getElementById('editField').innerText = `Edit ${field}`;
    document.getElementById('newValue').value = value;
    document.getElementById('editModal').style.display = 'flex';
}
function closeModal() { document.getElementById('editModal').style.display = 'none'; }

document.getElementById('saveEdit').addEventListener('click', async () => {
    const newVal = document.getElementById('newValue').value;
    if (!editField) return;
    const body = {
        field_name: editField,
        old_value: currentItem[editField],
        new_value: newVal,
        edited_by: 'admin'
    };
    await fetch(`/api/items/${line}/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    closeModal();
    loadItem();
});

function formatMoney(v) { return v ? `$${Number(v).toFixed(2)}` : ''; }

loadItem();
