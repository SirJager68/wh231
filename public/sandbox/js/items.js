async function loadItems() {
  try {
    const res = await fetch('/api/items');
    const items = await res.json();
    const tbody = document.querySelector('tbody');
    const search = document.getElementById('search');

    function render(filter='') {
      const f = filter.toLowerCase();
      const rows = items
        .filter(i => 
          (i.description && i.description.toLowerCase().includes(f)) ||
          (i.room_area && i.room_area.toLowerCase().includes(f))
        )
        .map(i => `
          <tr data-id="${i.line_number}">
            <td>${i.line_number}</td>
            <td>${i.room_area || ''}</td>
            <td>${i.quantity || ''}</td>
            <td>${i.description || ''}</td>
            <td>$${Number(i.unit_rcv || 0).toFixed(2)}</td>
            <td>$${Number(i.extended_rcv || 0).toFixed(2)}</td>
          </tr>
        `)
        .join('');
      tbody.innerHTML = rows;
    }

    render();

    search.addEventListener('input', e => render(e.target.value));

    tbody.addEventListener('click', e => {
      const row = e.target.closest('tr');
      if (row) {
        const id = row.dataset.id;
        window.location = `item.html?id=${id}`;
      }
    });
  } catch (err) {
    console.error('Error loading items:', err);
  }
}

loadItems();
