// Sample data to populate the database for testing
const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./database.db');

const sampleVerses = [
  {
    date: new Date().toISOString().split('T')[0], // Today
    content_type: 'text',
    verse_text: 'For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life.',
    bible_reference: 'John 3:16',
    context: 'This verse is often called the "Gospel in a nutshell" - it encapsulates the heart of Christian faith in God\'s love and salvation.',
    tags: 'love, salvation, hope, eternal life',
    published: 1,
    hearts: 5
  },
  {
    date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Yesterday
    content_type: 'text',
    verse_text: 'I can do all things through Christ who strengthens me.',
    bible_reference: 'Philippians 4:13',
    context: 'Paul wrote this while in prison, showing that true strength comes from faith in Christ, not from our circumstances.',
    tags: 'strength, perseverance, faith, courage',
    published: 1,
    hearts: 3
  },
  {
    date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 2 days ago
    content_type: 'text',
    verse_text: 'Trust in the Lord with all your heart and lean not on your own understanding; in all your ways submit to him, and he will make your paths straight.',
    bible_reference: 'Proverbs 3:5-6',
    context: 'A reminder to rely on God\'s wisdom rather than our limited human understanding when making decisions.',
    tags: 'trust, wisdom, guidance, faith',
    published: 1,
    hearts: 7
  },
  {
    date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 3 days ago
    content_type: 'text',
    verse_text: 'Be still, and know that I am God; I will be exalted among the nations, I will be exalted in the earth.',
    bible_reference: 'Psalm 46:10',
    context: 'In times of trouble and anxiety, this verse calls us to find peace in recognizing God\'s sovereignty and presence.',
    tags: 'peace, stillness, trust, sovereignty',
    published: 1,
    hearts: 4
  },
  {
    date: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 4 days ago
    content_type: 'text',
    verse_text: 'The Lord is my shepherd, I lack nothing. He makes me lie down in green pastures, he leads me beside quiet waters, he refreshes my soul.',
    bible_reference: 'Psalm 23:1-3',
    context: 'David\'s famous psalm portrays God as a caring shepherd who provides, protects, and guides his people.',
    tags: 'comfort, provision, guidance, peace',
    published: 1,
    hearts: 8
  }
];

console.log('Adding sample verses to database...');

sampleVerses.forEach((verse, index) => {
  db.run(`INSERT INTO verses (date, content_type, verse_text, bible_reference, context, tags, published, hearts) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [verse.date, verse.content_type, verse.verse_text, verse.bible_reference, verse.context, verse.tags, verse.published, verse.hearts],
    function(err) {
      if (err) {
        console.error(`Error inserting verse ${index + 1}:`, err);
      } else {
        console.log(`✓ Added verse for ${verse.date}: ${verse.bible_reference}`);
      }
      
      if (index === sampleVerses.length - 1) {
        console.log('Sample data insertion complete!');
        db.close();
      }
    });
});