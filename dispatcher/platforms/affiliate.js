/**
 * アフィリエイトリンク生成
 *
 * Amazon アソシエイト / 楽天アフィリエイト のリンクを生成する。
 * 生成したリンクはWordPress記事に埋め込むことで収益化。
 *
 * 必要な環境変数:
 *   AMAZON_ASSOCIATE_TAG=your-tag-20
 *   RAKUTEN_AFFILIATE_ID=your-rakuten-id（任意）
 */

const AMAZON_TAG = process.env.AMAZON_ASSOCIATE_TAG;
const RAKUTEN_ID = process.env.RAKUTEN_AFFILIATE_ID;

/**
 * Amazon商品URLにアソシエイトタグを付与
 * @param {string} productUrl - Amazon商品URL or ASIN
 * @returns {string} アフィリエイトリンク
 */
function amazonLink(productUrl) {
  if (!AMAZON_TAG) {
    throw new Error("AMAZON_ASSOCIATE_TAG が未設定です");
  }

  // ASINが直接渡された場合
  if (/^[A-Z0-9]{10}$/.test(productUrl)) {
    return `https://www.amazon.co.jp/dp/${productUrl}?tag=${AMAZON_TAG}`;
  }

  // URLの場合、tagパラメータを追加
  const url = new URL(productUrl);
  url.searchParams.set("tag", AMAZON_TAG);
  return url.toString();
}

/**
 * 楽天商品リンク生成
 */
function rakutenLink(itemUrl) {
  if (!RAKUTEN_ID) {
    throw new Error("RAKUTEN_AFFILIATE_ID が未設定です");
  }
  return `https://hb.afl.rakuten.co.jp/hgc/${RAKUTEN_ID}/?pc=${encodeURIComponent(itemUrl)}`;
}

/**
 * 商品情報からアフィリエイトHTML生成
 */
function generateAffiliateBlock({ title, amazonUrl, rakutenUrl, description }) {
  const parts = [];

  parts.push(`<div class="affiliate-block" style="border:1px solid #ddd;padding:16px;border-radius:8px;margin:16px 0;">`);
  parts.push(`<h3>${title}</h3>`);
  if (description) parts.push(`<p>${description}</p>`);
  parts.push(`<div style="display:flex;gap:8px;margin-top:8px;">`);

  if (amazonUrl && AMAZON_TAG) {
    const link = amazonLink(amazonUrl);
    parts.push(
      `<a href="${link}" target="_blank" rel="nofollow" style="background:#ff9900;color:#000;padding:8px 16px;border-radius:4px;text-decoration:none;font-weight:bold;">Amazonで見る</a>`
    );
  }
  if (rakutenUrl && RAKUTEN_ID) {
    const link = rakutenLink(rakutenUrl);
    parts.push(
      `<a href="${link}" target="_blank" rel="nofollow" style="background:#bf0000;color:#fff;padding:8px 16px;border-radius:4px;text-decoration:none;font-weight:bold;">楽天で見る</a>`
    );
  }

  parts.push(`</div></div>`);
  return parts.join("\n");
}

function isConfigured() {
  return !!(AMAZON_TAG || RAKUTEN_ID);
}

module.exports = { isConfigured, amazonLink, rakutenLink, generateAffiliateBlock };
