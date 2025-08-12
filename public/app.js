// public/app.js
// Runs after index.html loads

// Try to load weekly sales data
fetch('/api/weekly-sales')
    .then(res => {
        if (res.status === 401) {
            // Not logged in yet
            document.getElementById('login-container').style.display = 'block';
            return null;
        }
        return res.json();
    })
    .then(data => {
        if (!data) return;

        // Hide login link, show chart
        document.getElementById('login-container').style.display = 'none';
        document.getElementById('chart-container').style.display = 'block';

        // Draw chart
        new Chart(document.getElementById('salesChart'), {
            type: 'bar',
            data: {
                labels: ['Gross', 'COGS', 'Profit'],
                datasets: [{
                    label: 'Last 7 Days',
                    data: [data.gross, data.cogs, data.profit],
                    backgroundColor: ['#4CAF50', '#F44336', '#2196F3']
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { display: false }
                }
            }
        });
    })
    .catch(err => {
        console.error('Error loading sales data:', err);
    });
