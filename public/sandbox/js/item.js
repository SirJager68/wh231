async function loadItem() {
  const params = new URLSearchParams(window.location.search);
  const line = params.get('line'); // changed from id → line
  if (!line) return;

  try {
    const res = await fetch(`/api/items/${line}`);
    if (!res.ok) throw new Error("Item not found");
    const item = await res.json();
    const el = document.getElementById('item');

    if (item.error) {
      el.innerHTML = `<p>${item.error}</p>`;
      return;
    }

    el.innerHTML = `
      <h2>Item #${item.line_number}</h2>
      <p><span class="label">Room / Area:</span> ${item.room_area || ''}</p>
      <p><span class="label">Quantity:</span> ${item.quantity || ''}</p>
      <p><span class="label">Description:</span> ${item.description || ''}</p>
      <p><span class="label">Brand:</span> ${item.brand || ''}</p>
      <p><span class="label">Model:</span> ${item.model || ''}</p>
      <p><span class="label">Unit RCV:</span> $${Number(item.unit_rcv || 0).toFixed(2)}</p>
      <p><span class="label">Extended RCV:</span> $${Number(item.extended_rcv || 0).toFixed(2)}</p>
      <p><span class="label">ACV %:</span> ${item.acv_percent || ''}</p>
      <p><span class="label">ACV:</span> $${Number(item.acv || 0).toFixed(2)}</p>
      <p><span class="label">Notes:</span> ${item.notes || ''}</p>
      <p><span class="label">Source:</span> ${
        item.source_link
          ? `<a href="${item.source_link}" target="_blank">View Link</a>`
          : 'N/A'
      }</p>
    `;
  } catch (err) {
    console.error('Error loading item:', err);
    document.getElementById('item').innerHTML = "<p>Error loading item details.</p>";
  }
}

loadItem();
