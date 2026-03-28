/**
 * WordPress REST API 連携
 *
 * 実際にWordPressサイトへ記事を投稿する。
 * WordPress管理画面 > ユーザー > アプリケーションパスワード で発行。
 *
 * 必要な環境変数:
 *   WP_SITE_URL=https://your-site.com
 *   WP_USERNAME=admin
 *   WP_APP_PASSWORD=xxxx xxxx xxxx xxxx xxxx xxxx
 */

const WP_SITE_URL = process.env.WP_SITE_URL;
const WP_USERNAME = process.env.WP_USERNAME;
const WP_APP_PASSWORD = process.env.WP_APP_PASSWORD;

function isConfigured() {
  return !!(WP_SITE_URL && WP_USERNAME && WP_APP_PASSWORD);
}

function getAuthHeader() {
  const token = Buffer.from(`${WP_USERNAME}:${WP_APP_PASSWORD}`).toString(
    "base64"
  );
  return `Basic ${token}`;
}

/**
 * WordPressに記事を投稿
 * @param {object} params
 * @param {string} params.title - 記事タイトル
 * @param {string} params.content - 記事本文（HTML可）
 * @param {string} [params.status] - publish | draft（デフォルト: draft）
 * @param {number[]} [params.categories] - カテゴリID配列
 * @param {string[]} [params.tags] - タグ名配列
 * @returns {{ id: number, url: string, status: string }}
 */
async function createPost({ title, content, status = "draft", categories, tags }) {
  if (!isConfigured()) {
    throw new Error(
      "WordPress未設定。WP_SITE_URL, WP_USERNAME, WP_APP_PASSWORD を .env に設定してください"
    );
  }

  const body = {
    title,
    content,
    status,
  };
  if (categories) body.categories = categories;
  if (tags) body.tags = tags;

  const res = await fetch(`${WP_SITE_URL}/wp-json/wp/v2/posts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: getAuthHeader(),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`WordPress投稿失敗: ${res.status} ${err}`);
  }

  const post = await res.json();
  return {
    id: post.id,
    url: post.link,
    status: post.status,
  };
}

/**
 * 投稿を更新
 */
async function updatePost(postId, updates) {
  if (!isConfigured()) throw new Error("WordPress未設定");

  const res = await fetch(`${WP_SITE_URL}/wp-json/wp/v2/posts/${postId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: getAuthHeader(),
    },
    body: JSON.stringify(updates),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`WordPress更新失敗: ${res.status} ${err}`);
  }

  return res.json();
}

/**
 * 投稿のPV数を取得（WordPress Stats API / Jetpack必要）
 * Jetpackがなければ0を返す
 */
async function getPostViews(postId) {
  if (!isConfigured()) return 0;

  try {
    const res = await fetch(
      `${WP_SITE_URL}/wp-json/wp/v2/posts/${postId}`,
      {
        headers: { Authorization: getAuthHeader() },
      }
    );
    if (!res.ok) return 0;
    const post = await res.json();
    // Jetpack/WP.com Stats が有効な場合
    return post.jetpack_stats?.views || 0;
  } catch {
    return 0;
  }
}

module.exports = { isConfigured, createPost, updatePost, getPostViews };
