import sqlite3
import os
import re
from datetime import datetime
from flask import Flask, render_template, request, jsonify

app = Flask(__name__)
DB_FILE = 'campus_find.db'


# ==========================================
# DATABASE HELPER FUNCTIONS
# ==========================================

def get_db_connection():
    """Establishes and returns a connection to the SQLite database."""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row  # Returns rows as dictionaries
    return conn


def init_db():
    """Creates the items table if it does not already exist."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            location TEXT NOT NULL,
            date TEXT NOT NULL,
            status TEXT NOT NULL,  -- 'lost' or 'found'
            contact TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()


# ==========================================
# AI MATCHING ALGORITHM
# ==========================================

# Basic English stop words to ignore when comparing keywords
STOP_WORDS = {
    'a', 'an', 'the', 'is', 'at', 'by', 'for', 'in', 'of', 'on', 'to', 'with',
    'and', 'or', 'my', 'it', 'was', 'this', 'that', 'i', 'lost', 'found', 'near',
    'at', 'around', 'some', 'any', 'black', 'white', 'blue', 'red', 'green'
}


def clean_tokens(text):
    """Converts text to lowercase, removes punctuation, and splits into clean keyword tokens."""
    if not text:
        return set()
    # Remove non-alphanumeric characters and convert to lowercase
    words = re.findall(r'\b\w+\b', text.lower())
    # Filter out short words and common stop words
    tokens = {w for w in words if w not in STOP_WORDS and len(w) > 1}
    return tokens


def calculate_similarity_score(lost_item, found_item):
    """
    Computes a similarity score (0 to 100%) between a lost item and a found item.
    
    Structure:
    - Compares title keywords (Weight: 45%)
    - Compares description keywords (Weight: 35%)
    - Compares location keywords (Weight: 20%)
    
    Note: This local algorithm can be easily replaced or enhanced with an external AI/LLM API in the future.
    """
    # 1. Title matching
    lost_title_tokens = clean_tokens(lost_item.get('title', ''))
    found_title_tokens = clean_tokens(found_item.get('title', ''))
    
    title_score = 0.0
    if lost_title_tokens and found_title_tokens:
        intersection = lost_title_tokens.intersection(found_title_tokens)
        union = lost_title_tokens.union(found_title_tokens)
        title_score = (len(intersection) / len(union)) * 100.0

    # 2. Description matching
    lost_desc_tokens = clean_tokens(lost_item.get('description', ''))
    found_desc_tokens = clean_tokens(found_item.get('description', ''))
    
    desc_score = 0.0
    if lost_desc_tokens and found_desc_tokens:
        intersection = lost_desc_tokens.intersection(found_desc_tokens)
        union = lost_desc_tokens.union(found_desc_tokens)
        desc_score = (len(intersection) / len(union)) * 100.0

    # 3. Location matching
    lost_loc_tokens = clean_tokens(lost_item.get('location', ''))
    found_loc_tokens = clean_tokens(found_item.get('location', ''))
    
    loc_score = 0.0
    if lost_loc_tokens and found_loc_tokens:
        intersection = lost_loc_tokens.intersection(found_loc_tokens)
        union = lost_loc_tokens.union(found_loc_tokens)
        loc_score = (len(intersection) / len(union)) * 100.0

    # Direct substring matches bonus (e.g. "airpods" in both titles)
    bonus = 0
    lost_title_str = lost_item.get('title', '').strip().lower()
    found_title_str = found_item.get('title', '').strip().lower()
    if lost_title_str and (lost_title_str in found_title_str or found_title_str in lost_title_str):
        bonus += 15

    # Calculate weighted total score
    total_score = (title_score * 0.45) + (desc_score * 0.35) + (loc_score * 0.20) + bonus
    
    # Cap total score between 0 and 100
    final_score = round(min(100.0, max(0.0, total_score)))
    return final_score


def find_ai_matches(lost_item, candidate_items, min_score=15):
    """
    Finds and ranks candidate items (e.g., FOUND items) that match the provided lost item.
    Returns a list of candidate dictionaries augmented with a 'match_score' percentage.
    """
    matches = []
    for candidate in candidate_items:
        # Convert row or dict to standard dict
        cand_dict = dict(candidate)
        score = calculate_similarity_score(lost_item, cand_dict)
        if score >= min_score:
            cand_dict['match_score'] = score
            matches.append(cand_dict)
            
    # Sort matches by score descending
    matches.sort(key=lambda x: x['match_score'], reverse=True)
    return matches


# ==========================================
# FLASK ROUTES
# ==========================================

@app.route('/')
def home():
    """Serves the main frontend single-page app."""
    return render_template('index.html')


@app.route('/api/items', methods=['GET'])
def get_items():
    """
    Retrieves items from the database.
    Optional query parameter: status ('lost', 'found', or 'all')
    """
    status_filter = request.args.get('status', 'all').lower()
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    if status_filter in ['lost', 'found']:
        cursor.execute('SELECT * FROM items WHERE LOWER(status) = ? ORDER BY id DESC', (status_filter,))
    else:
        cursor.execute('SELECT * FROM items ORDER BY id DESC')
        
    rows = cursor.fetchall()
    conn.close()
    
    items = [dict(row) for row in rows]
    return jsonify({'success': True, 'items': items})


@app.route('/api/search', methods=['GET'])
def search_items():
    """
    Searches items matching a query term across title, description, and location.
    """
    query = request.args.get('q', '').strip()
    if not query:
        return jsonify({'success': True, 'items': []})
        
    search_pattern = f"%{query}%"
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT * FROM items 
        WHERE title LIKE ? OR description LIKE ? OR location LIKE ?
        ORDER BY id DESC
    ''', (search_pattern, search_pattern, search_pattern))
    
    rows = cursor.fetchall()
    conn.close()
    
    items = [dict(row) for row in rows]
    return jsonify({'success': True, 'query': query, 'items': items})


@app.route('/api/items', methods=['POST'])
def create_item():
    """
    Saves a new lost or found item to SQLite.
    If the item status is 'lost', automatically searches for matching 'found' items.
    """
    data = request.get_json() or {}
    
    # Field validation
    title = data.get('title', '').strip()
    description = data.get('description', '').strip()
    location = data.get('location', '').strip()
    date = data.get('date', '').strip()
    status = data.get('status', '').strip().lower()
    contact = data.get('contact', '').strip()
    
    if not all([title, description, location, date, status, contact]):
        return jsonify({
            'success': False, 
            'error': 'All fields (title, description, location, date, status, contact) are required.'
        }), 400

    if status not in ['lost', 'found']:
        return jsonify({'success': False, 'error': 'Status must be "lost" or "found".'}), 400

    # Save to SQLite
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO items (title, description, location, date, status, contact)
        VALUES (?, ?, ?, ?, ?, ?)
    ''', (title, description, location, date, status, contact))
    
    item_id = cursor.lastrowid
    conn.commit()
    
    # Fetch the newly created record
    cursor.execute('SELECT * FROM items WHERE id = ?', (item_id,))
    new_item = dict(cursor.fetchone())
    
    # Check for matches if new item is lost
    matches = []
    if status == 'lost':
        cursor.execute('SELECT * FROM items WHERE LOWER(status) = "found"')
        found_items = cursor.fetchall()
        matches = find_ai_matches(new_item, found_items)
        
    conn.close()
    
    return jsonify({
        'success': True,
        'message': f'Successfully reported {status} item!',
        'item': new_item,
        'matches': matches
    }), 201


@app.route('/api/match', methods=['POST'])
def match_item():
    """
    API endpoint to explicitly trigger AI matching for a lost item against found items in the database.
    Accepts JSON with item details or item ID.
    """
    data = request.get_json() or {}
    item_id = data.get('id')
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    lost_item = None
    if item_id:
        cursor.execute('SELECT * FROM items WHERE id = ?', (item_id,))
        row = cursor.fetchone()
        if row:
            lost_item = dict(row)
            
    if not lost_item:
        lost_item = {
            'title': data.get('title', ''),
            'description': data.get('description', ''),
            'location': data.get('location', ''),
            'status': 'lost'
        }

    # Retrieve all FOUND items from DB
    cursor.execute('SELECT * FROM items WHERE LOWER(status) = "found"')
    found_rows = cursor.fetchall()
    conn.close()
    
    matches = find_ai_matches(lost_item, found_rows)
    return jsonify({
        'success': True,
        'target_item': lost_item,
        'matches': matches
    })


# ==========================================
# SEED INITIAL DEMO DATA
# ==========================================

def seed_sample_data():
    """Seeds sample data into database if empty, so the user can immediately test searching and matching."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT COUNT(*) as count FROM items')
    count = cursor.fetchone()['count']
    
    if count == 0:
        sample_items = [
            ('Blue Water Bottle', 'Hydro Flask 32oz blue metal water bottle with sticker on front', 'Library 2nd Floor', '2025-03-20', 'lost', 'alex@campus.edu'),
            ('Apple AirPods Pro', 'AirPods Pro white charging case found near computer lab desk', 'Science Building Lab 102', '2025-03-21', 'found', 'security@campus.edu'),
            ('TI-84 Plus Calculator', 'Texas Instruments graphing calculator with name scratched on back', 'Student Union Cafe', '2025-03-19', 'lost', 'sam@campus.edu'),
            ('Blue Hydro Flask', 'Found a blue water bottle on study table in library', 'Library 2nd Floor', '2025-03-20', 'found', 'library-desk@campus.edu'),
            ('Black Backpack', 'JanSport black backpack with laptop and notebooks inside', 'Engineering Hall Room 304', '2025-03-22', 'lost', 'jordan@campus.edu'),
            ('AirPods Pro Case', 'White AirPods wireless charging case found under seat', 'Science Building', '2025-03-21', 'found', 'mike@campus.edu'),
            ('Campus ID Card', 'Student ID card belonging to Sarah Parker', 'Dining Hall Entrance', '2025-03-22', 'found', 'dining@campus.edu'),
            ('Denim Jacket', 'Blue denim jacket, size M, left on chair in lecture hall', 'Main Auditorium', '2025-03-18', 'lost', 'taylor@campus.edu')
        ]
        
        cursor.executemany('''
            INSERT INTO items (title, description, location, date, status, contact)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', sample_items)
        conn.commit()
        print("Sample demo items seeded into database!")
        
    conn.close()


if __name__ == '__main__':
    # Initialize DB table and sample data
    init_db()
    seed_sample_data()
    print("Starting Campus Find server on http://127.0.0.1:5000 ...")
    app.run(debug=True, host='0.0.0.0', port=5000)
