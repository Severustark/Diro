# Diro — Gerçek Zamanlı Whiteboard

Miro benzeri, çok kullanıcılı, gerçek zamanlı beyaz tahta uygulaması.

## Teknoloji Yığını

| Katman   | Teknoloji            | Amaç                                    |
| -------- | -------------------- | --------------------------------------- |
| Canvas   | Fabric.js 5.x        | Şekil, metin, çizim, sürükle-bırak      |
| CRDT     | Yjs (Y.Doc + Y.Map)  | Conflict-free veri senkronizasyonu      |
| Ağ       | y-webrtc             | P2P WebRTC bağlantısı (sunucu gereksiz) |
| Fallback | BroadcastChannel API | Aynı tarayıcı, farklı sekmeler          |

## Kurulum & Çalıştırma

### Seçenek 1: Direkt Aç (Yerel mod)

```bash
# Herhangi bir statik sunucu ile aç
npx serve .
# veya
python3 -m http.server 8080
# veya VS Code Live Server extension
```

Tarayıcıda `http://localhost:8080` aç.

### Seçenek 2: İki Tarayıcı Sekmesinde Test

1. `http://localhost:8080` adresini iki farklı sekmede aç
2. Birinde "Oda Oluştur", diğerinde "Odaya Katıl" seç
3. Oda kodunu kopyalayıp yapıştır
4. Gerçek zamanlı senkronizasyon başlar

### Seçenek 3: Farklı Cihazlar (WebRTC)

- Aynı yerel ağda iseniz: `http://<IP>:8080` kullan
- İnternet üzerinden: `netlify drop` veya `surge.sh` ile yayınla
- WebRTC sinyalizasyon sunucusu: `signaling.yjs.dev` (ücretsiz, public)

## Özellikler

### Araçlar (Klavye Kısayolları)

| Araç          | Kısayol | Açıklama                                 |
| ------------- | ------- | ---------------------------------------- |
| Seç           | `V`     | Nesneleri seç, taşı, yeniden boyutlandır |
| El            | `H`     | Tuvali kaydır                            |
| Metin         | `T`     | Çift tıkla düzenle                       |
| Yapışkan Not  | `N`     | Renkli post-it notlar                    |
| Dikdörtgen    | `R`     | Sürükleyerek çiz                         |
| Daire/Elips   | `C`     | Sürükleyerek çiz                         |
| Ok            | `A`     | Bağlantı okları                          |
| Serbest Çizim | `D`     | Kalem modu                               |
| Silgi         | `E`     | Nesne sil                                |

### Diğer Kısayollar

- `Delete` / `Backspace` — Seçili nesneyi sil
- `Ctrl+Z` — Son nesneyi geri al
- `Ctrl++/-` — Yakınlaş/uzaklaş
- `Ctrl+0` — Zoom sıfırla
- `Mouse wheel` — Smooth zoom

### Sol Panel

- **Renk** — 9 hazır renk + özel renk seçici
- **Dolgu** — Şekil dolgu rengi
- **Kalınlık** — 1-20px stroke
- **Opaklık** — %10-100
- **Yazı Boyutu** — 8-72px
- **Katmanlar** — Öne/arkaya taşı, sil

### Sağ Üst

- **Aktif kullanıcılar** — Avatar'lar canlı güncellenir
- **PNG İndir** — 2x çözünürlük export
- **Temizle** — Tüm tuvali sil
- **Çık** — Odadan ayrıl

## CRDT Mimarisi

```
Kullanıcı A (tarayıcı)          Kullanıcı B (tarayıcı)
┌─────────────────┐              ┌─────────────────┐
│   Fabric.js     │              │   Fabric.js     │
│   (Canvas)      │              │   (Canvas)      │
└────────┬────────┘              └────────┬────────┘
         │ events                          │ events
┌────────▼────────┐              ┌────────▼────────┐
│   Y.Doc         │◄────────────►│   Y.Doc         │
│   Y.Map         │  y-webrtc    │   Y.Map         │
│   (CRDT)        │  WebRTC P2P  │   (CRDT)        │
└─────────────────┘              └─────────────────┘
```

**Çakışma çözümü**: Yjs CRDT, eş zamanlı düzenlemeleri otomatik birleştirir.
Her nesne `_id` ile tanımlanır, `Y.Map`'te saklanır.

## Dosya Yapısı

```
miro-clone/
├── index.html          # Ana HTML (modal + app layout)
├── src/
│   ├── styles.css      # Tüm stiller (dark theme)
│   └── app.js          # Uygulama mantığı
└── README.md
```

## Geliştirme Notları

### Sonraki Adımlar (2. Aşama)

- [ ] WebSocket tabanlı signaling sunucusu (daha güvenilir)
- [ ] Kullanıcı izinleri (sadece oku, düzenle)
- [ ] Yorum/mention sistemi
- [ ] Sayfa/Frame desteği
- [ ] Image upload (drag & drop)
- [ ] Şablon kütüphanesi
- [ ] Export: PDF, SVG

### Bağımlılıklar (CDN)

- `yjs@13.6.14` — CRDT engine
- `y-webrtc@10.2.3` — WebRTC provider
- `fabric.js@5.3.1` — Canvas kütüphanesi
- `DM Sans` + `DM Mono` — Google Fonts
