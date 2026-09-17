/* ==========================================
   CAMPUS FIND - FRONTEND SCRIPT
   Handles API integration, Modals, Search, and AI Matching UI
   ========================================== */

// Global State
let currentFilter = 'all';
let allLoadedItems = [];

// DOM Loaded Event Listener
document.addEventListener('DOMContentLoaded', () => {
    // Set today's date as default in report form
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('itemDate').value = today;

    // Load initial item list
    loadItems();
});

// ==========================================
// API FETCH & DISPLAY FUNCTIONS
// ==========================================

/**
 * Fetches all items from backend API with optional status filter.
 */
async function loadItems(status = currentFilter) {
    const itemsGrid = document.getElementById('itemsGrid');
    const emptyState = document.getElementById('emptyState');
    
    itemsGrid.innerHTML = '<div class="loading-spinner">Loading items...</div>';
    emptyState.style.display = 'none';

    try {
        const response = await fetch(`/api/items?status=${status}`);
        const data = await response.json();

        if (data.success) {
            allLoadedItems = data.items;
            renderItems(data.items);
        } else {
            showAlert('Failed to load items.', 'error');
        }
    } catch (error) {
        console.error('Error fetching items:', error);
        itemsGrid.innerHTML = '';
        showAlert('Network error while connecting to server.', 'error');
    }
}

/**
 * Renders an array of item objects into cards inside the items grid.
 */
function renderItems(items) {
    const itemsGrid = document.getElementById('itemsGrid');
    const emptyState = document.getElementById('emptyState');
    const itemsCount = document.getElementById('itemsCount');

    itemsGrid.innerHTML = '';

    if (!items || items.length === 0) {
        emptyState.style.display = 'block';
        itemsCount.textContent = '0 items found';
        return;
    }

    emptyState.style.display = 'none';
    const filterText = currentFilter === 'all' ? 'all' : currentFilter;
    itemsCount.textContent = `Showing ${items.length} ${filterText} item${items.length === 1 ? '' : 's'}`;

    items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'item-card';

        const isLost = item.status.toLowerCase() === 'lost';
        const badgeClass = isLost ? 'badge-lost' : 'badge-found';
        const badgeText = isLost ? 'LOST' : 'FOUND';

        card.innerHTML = `
            <div>
                <div class="card-header">
                    <h3 class="card-title">${escapeHtml(item.title)}</h3>
                    <span class="badge ${badgeClass}">${badgeText}</span>
                </div>
                <p class="card-description">${escapeHtml(item.description)}</p>
            </div>

            <div>
                <div class="card-meta">
                    <div class="meta-item">
                        <span>📍</span> <strong>Location:</strong> ${escapeHtml(item.location)}
                    </div>
                    <div class="meta-item">
                        <span>📅</span> <strong>Date:</strong> ${escapeHtml(item.date)}
                    </div>
                    <div class="meta-item">
                        <span>✉️</span> <strong>Contact:</strong> ${escapeHtml(item.contact)}
                    </div>
                </div>

                <div class="card-actions">
                    ${isLost ? `
                        <button class="btn btn-sm btn-light" onclick="checkMatchesForCard(${item.id})">
                            🤖 Check AI Matches
                        </button>
                    ` : ''}
                    <button class="btn btn-sm btn-primary" onclick="contactReporter('${escapeHtml(item.contact)}', '${escapeHtml(item.title)}')">
                        Contact Person
                    </button>
                </div>
            </div>
        `;

        itemsGrid.appendChild(card);
    });
}

// ==========================================
// SEARCH FUNCTIONALITY
// ==========================================

/**
 * Executes a search against the Flask backend API.
 */
async function triggerSearch() {
    const query = document.getElementById('searchInput').value.trim();
    const clearBtn = document.getElementById('clearSearchBtn');

    if (!query) {
        clearBtn.style.display = 'none';
        loadItems(currentFilter);
        return;
    }

    clearBtn.style.display = 'inline-block';
    const itemsGrid = document.getElementById('itemsGrid');
    itemsGrid.innerHTML = '<div class="loading-spinner">Searching...</div>';

    try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await response.json();

        if (data.success) {
            renderItems(data.items);
            document.getElementById('itemsCount').textContent = `Search results for "${query}" (${data.items.length})`;
        }
    } catch (error) {
        console.error('Error during search:', error);
        showAlert('Search failed. Please try again.', 'error');
    }
}

/**
 * Triggers search on Enter key press.
 */
function handleSearchKeyup(event) {
    if (event.key === 'Enter') {
        triggerSearch();
    }
}

/**
 * Clears search input and resets grid to default.
 */
function clearSearch() {
    document.getElementById('searchInput').value = '';
    document.getElementById('clearSearchBtn').style.display = 'none';
    loadItems(currentFilter);
}

// ==========================================
// TAB FILTERING
// ==========================================

function filterItems(status, tabElement) {
    currentFilter = status;
    
    // Update active tab UI
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    tabElement.classList.add('active');

    // Reset search bar if active
    document.getElementById('searchInput').value = '';
    document.getElementById('clearSearchBtn').style.display = 'none';

    loadItems(status);
}

// ==========================================
// REPORT ITEM MODAL & FORM HANDLING
// ==========================================

function openReportModal(statusType = 'lost') {
    const modal = document.getElementById('reportModal');
    const modalTitle = document.getElementById('modalTitle');
    const statusSelect = document.getElementById('itemStatus');
    const formError = document.getElementById('formError');

    // Reset form
    document.getElementById('reportForm').reset();
    formError.style.display = 'none';
    document.getElementById('itemDate').value = new Date().toISOString().split('T')[0];

    statusSelect.value = statusType;
    modalTitle.textContent = statusType === 'lost' ? 'Report Lost Item' : 'Report Found Item';

    updateFormTheme();
    modal.style.display = 'flex';
}

function closeReportModal() {
    document.getElementById('reportModal').style.display = 'none';
}

function updateFormTheme() {
    const status = document.getElementById('itemStatus').value;
    const submitBtn = document.getElementById('submitBtn');

    if (status === 'lost') {
        submitBtn.className = 'btn btn-danger';
        submitBtn.textContent = 'Submit Lost Item Report';
    } else {
        submitBtn.className = 'btn btn-success';
        submitBtn.textContent = 'Submit Found Item Report';
    }
}

/**
 * Form submission handler with validation and API call.
 */
async function handleFormSubmit(event) {
    event.preventDefault();

    const formError = document.getElementById('formError');
    formError.style.display = 'none';

    const payload = {
        title: document.getElementById('itemTitle').value.trim(),
        description: document.getElementById('itemDescription').value.trim(),
        location: document.getElementById('itemLocation').value.trim(),
        date: document.getElementById('itemDate').value,
        status: document.getElementById('itemStatus').value,
        contact: document.getElementById('itemContact').value.trim()
    };

    // Front-end Validation
    if (!payload.title || !payload.description || !payload.location || !payload.date || !payload.contact) {
        formError.textContent = 'Please fill out all required fields.';
        formError.style.display = 'block';
        return;
    }

    try {
        const response = await fetch('/api/items', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (response.ok && data.success) {
            closeReportModal();
            showAlert(`Success: ${data.message}`, 'success');
            
            // Reload grid
            loadItems(currentFilter);

            // If a lost item was submitted and matches were found, open AI matches modal
            if (payload.status === 'lost' && data.matches && data.matches.length > 0) {
                displayMatchesModal(data.item, data.matches);
            }
        } else {
            formError.textContent = data.error || 'Failed to submit report.';
            formError.style.display = 'block';
        }
    } catch (error) {
        console.error('Error submitting form:', error);
        formError.textContent = 'Server connection error. Please try again.';
        formError.style.display = 'block';
    }
}

// ==========================================
// AI MATCHING DISPLAY
// ==========================================

/**
 * Manually checks AI matches for a lost item from card button.
 */
async function checkMatchesForCard(itemId) {
    try {
        const response = await fetch('/api/match', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: itemId })
        });

        const data = await response.json();

        if (data.success) {
            displayMatchesModal(data.target_item, data.matches);
        } else {
            showAlert('Could not analyze matches at this time.', 'error');
        }
    } catch (error) {
        console.error('Error checking matches:', error);
        showAlert('Error requesting match analysis.', 'error');
    }
}

/**
 * Renders the AI matches popup modal with similarity scores.
 */
function displayMatchesModal(lostItem, matches) {
    const matchesModal = document.getElementById('matchesModal');
    const lostSummary = document.getElementById('matchesLostSummary');
    const matchesList = document.getElementById('matchesList');

    // Display summary of the lost item
    lostSummary.innerHTML = `
        <strong>Lost Item:</strong> ${escapeHtml(lostItem.title)} <br>
        <small><strong>Location:</strong> ${escapeHtml(lostItem.location)} | <strong>Description:</strong> ${escapeHtml(lostItem.description)}</small>
    `;

    matchesList.innerHTML = '';

    if (!matches || matches.length === 0) {
        matchesList.innerHTML = `
            <div class="empty-state">
                <p>No high-confidence matches found in the database yet.</p>
                <small>As other students report found items, possible matches will appear here.</small>
            </div>
        `;
    } else {
        matches.forEach(match => {
            const card = document.createElement('div');
            card.className = 'match-card';
            card.innerHTML = `
                <div>
                    <h4 style="margin-bottom: 4px; font-size: 1.05rem;">${escapeHtml(match.title)}</h4>
                    <p style="color: #475569; font-size: 0.9rem; margin-bottom: 8px;">${escapeHtml(match.description)}</p>
                    <div style="font-size: 0.82rem; color: #64748b;">
                        <span>📍 Found at: <strong>${escapeHtml(match.location)}</strong></span> &bull; 
                        <span>📅 Date: ${escapeHtml(match.date)}</span> &bull;
                        <span>✉️ Contact: <strong>${escapeHtml(match.contact)}</strong></span>
                    </div>
                </div>
                <div style="text-align: center; min-width: 110px;">
                    <div class="match-score-pill">
                        🎯 ${match.match_score}% Match
                    </div>
                    <button class="btn btn-sm btn-primary" style="margin-top: 8px; width: 100%;" 
                        onclick="contactReporter('${escapeHtml(match.contact)}', '${escapeHtml(match.title)}')">
                        Contact
                    </button>
                </div>
            `;
            matchesList.appendChild(card);
        });
    }

    matchesModal.style.display = 'flex';
}

function closeMatchesModal() {
    document.getElementById('matchesModal').style.display = 'none';
}

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

function contactReporter(contactInfo, title) {
    alert(`To claim or inquire about "${title}", contact:\n\n${contactInfo}`);
}

function showAlert(message, type = 'success') {
    const alertBanner = document.getElementById('alertBanner');
    alertBanner.className = `alert-banner ${type}`;
    alertBanner.textContent = message;
    alertBanner.style.display = 'flex';

    setTimeout(() => {
        alertBanner.style.display = 'none';
    }, 5000);
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
