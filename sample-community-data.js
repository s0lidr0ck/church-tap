// Sample community data to test Phase 2 features
const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./database.db');

const today = new Date().toISOString().split('T')[0];
const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

const samplePrayerRequests = [
  {
    date: today,
    content: 'Please pray for my grandmother who is in the hospital. She has been fighting cancer and could use all the prayers she can get.',
    user_token: 'user_sample_1',
    ip_address: '192.168.1.100'
  },
  {
    date: today,
    content: 'Pray for my job interview tomorrow. I really need this opportunity to provide for my family.',
    user_token: 'user_sample_2',
    ip_address: '192.168.1.101'
  },
  {
    date: yesterday,
    content: 'Please pray for peace in our community after the recent events. We need unity and healing.',
    user_token: 'user_sample_3',
    ip_address: '192.168.1.102'
  }
];

const samplePraiseReports = [
  {
    date: today,
    content: 'My daughter just graduated from college! Thank God for His faithfulness through her studies.',
    user_token: 'user_sample_4',
    ip_address: '192.168.1.103'
  },
  {
    date: today,
    content: 'We welcomed a healthy baby boy into our family this morning. God is so good!',
    user_token: 'user_sample_5',
    ip_address: '192.168.1.104'
  },
  {
    date: yesterday,
    content: 'Got the job I was praying for! Thank you everyone who prayed with me.',
    user_token: 'user_sample_6',
    ip_address: '192.168.1.105'
  }
];

console.log('Adding sample community data...');

// Add prayer requests
samplePrayerRequests.forEach((request, index) => {
  db.run(`INSERT INTO ct_prayer_requests (date, content, user_token, ip_address, prayer_count) VALUES (?, ?, ?, ?, ?)`,
    [request.date, request.content, request.user_token, request.ip_address, Math.floor(Math.random() * 10) + 1],
    function(err) {
      if (err) {
        console.error(`Error inserting prayer request ${index + 1}:`, err);
      } else {
        console.log(`✓ Added prayer request for ${request.date}`);
      }
    });
});

// Add praise reports
samplePraiseReports.forEach((report, index) => {
  db.run(`INSERT INTO ct_praise_reports (date, content, user_token, ip_address, celebration_count) VALUES (?, ?, ?, ?, ?)`,
    [report.date, report.content, report.user_token, report.ip_address, Math.floor(Math.random() * 15) + 1],
    function(err) {
      if (err) {
        console.error(`Error inserting praise report ${index + 1}:`, err);
      } else {
        console.log(`✓ Added praise report for ${report.date}`);
      }
      
      // Add interactions after last item
      if (index === samplePraiseReports.length - 1) {
        setTimeout(() => {
          console.log('Sample community data insertion complete!');
          addSampleInteractions();
        }, 200);
      }
    });
});

function addSampleInteractions() {
  console.log('Adding sample interactions...');
  
  // Add some prayer interactions
  const sampleInteractions = [
    { prayer_request_id: 1, user_token: 'user_pray_1', ip_address: '192.168.1.200' },
    { prayer_request_id: 1, user_token: 'user_pray_2', ip_address: '192.168.1.201' },
    { prayer_request_id: 2, user_token: 'user_pray_3', ip_address: '192.168.1.202' }
  ];
  
  sampleInteractions.forEach((interaction, index) => {
    db.run(`INSERT INTO ct_prayer_interactions (prayer_request_id, user_token, ip_address) VALUES (?, ?, ?)`,
      [interaction.prayer_request_id, interaction.user_token, interaction.ip_address], (err) => {
        if (err) console.error('Error adding prayer interaction:', err);
      });
  });
  
  // Add some celebration interactions
  const celebrationInteractions = [
    { praise_report_id: 1, user_token: 'user_celebrate_1', ip_address: '192.168.1.300' },
    { praise_report_id: 2, user_token: 'user_celebrate_2', ip_address: '192.168.1.301' }
  ];
  
  celebrationInteractions.forEach((interaction, index) => {
    db.run(`INSERT INTO ct_celebration_interactions (praise_report_id, user_token, ip_address) VALUES (?, ?, ?)`,
      [interaction.praise_report_id, interaction.user_token, interaction.ip_address], (err) => {
        if (err) console.error('Error adding celebration interaction:', err);
        
        // Close database after last interaction
        if (index === celebrationInteractions.length - 1) {
          setTimeout(() => {
            console.log('✓ Added sample interactions');
            console.log('All sample data complete!');
            db.close();
          }, 100);
        }
      });
  });
}