const SETTINGS = {
  TARGET_FOLDER: '', // チェック対象フォルダID
  SLACK_URL: '', // Slack通知用Webhook URL
  SAFE_DOMAINS: ['fw@gmail.com', 'gmail.com'], // 許可ドメイン
  IGNORE_KEYWORD: '【共有用】' // チェック除外キーワード
};

function main() {
  const violations = [];
  walkFolder(SETTINGS.TARGET_FOLDER, violations);
  
  if (violations.length > 0) {
    postSlack(violations);
  } else {
    console.log('異常なし');
  }
}

// 再帰的に探索
function walkFolder(folderId, outputList) {
  let pageToken = null;
  const fields = 'nextPageToken, files(id, name, mimeType, webViewLink, permissions(emailAddress, role, type), shared)';

  do {
    const res = Drive.Files.list({
      q: `'${folderId}' in parents and trashed = false`,
      pageToken: pageToken,
      pageSize: 1000,
      fields: fields
    });

    const files = res.files || [];
    if (!files.length) return;

    for (const file of files) {
      if (file.mimeType === 'application/vnd.google-apps.folder') {
        walkFolder(file.id, outputList);
      } else {
        // ファイル名チェック
        if (file.name.includes(SETTINGS.IGNORE_KEYWORD)) continue;
        
        const errors = validatePermissions(file);
        if (errors.length) {
          outputList.push({
            name: file.name,
            url: file.webViewLink,
            errors: errors
          });
        }
      }
    }
    pageToken = res.nextPageToken;
  } while (pageToken);
}

// 権限の中身を検証
function validatePermissions(file) {
  if (!file.shared || !file.permissions) return [];

  const errors = [];
  
  // リンク共有チェック
  if (file.permissions.some(p => p.type === 'anyone')) {
    errors.push('⚠️ リンクを知っている全員がアクセス可能');
  }

  // ドメインチェック
  for (const p of file.permissions) {
    if (p.role === 'owner' || !p.emailAddress) continue;
    
    const isSafe = SETTINGS.SAFE_DOMAINS.some(d => p.emailAddress.endsWith(d));
    if (!isSafe) {
      errors.push(`🚫 外部共有: ${p.emailAddress} [${p.role}]`);
    }
  }

  return errors;
}

// 通知送信
function postSlack(data) {
  console.log(`${data.length}件の違反を検出。`);

  // 上位30件のみ
  const displayLimit = 30;
  const attachments = data.slice(0, displayLimit).map(d => ({
    color: '#danger',
    title: d.name,
    title_link: d.url,
    text: d.errors.join('\n')
  }));

  if (data.length > displayLimit) {
    attachments.push({
      text: `...他 ${data.length - displayLimit} 件（件数が多いため省略）`,
      color: '#warning'
    });
  }

  UrlFetchApp.fetch(SETTINGS.SLACK_URL, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      text: `🚨 Drive権限チェック: ${data.length}件の不備が見つかりました`,
      attachments: attachments
    })
  });
}