# Design Document

## Overview

カスタマイズ可能な3Dサイコロアプリケーションは、Three.jsを使用したブラウザベースの静的Webアプリケーションです。ユーザーは6面体または8面体のサイコロを選択し、各面に任意の値を設定して、カジノ風の3D環境でサイコロを投げることができます。物理演算にはCannon.jsを使用し、リアルな投げアニメーションを実現します。

## Architecture

### Technology Stack

- **Three.js**: 3Dグラフィックスレンダリング（WebGL）
- **Cannon.js**: 物理演算エンジン
- **Vanilla JavaScript**: フレームワークなしの純粋なJS（静的ホスティング対応）
- **LocalStorage API**: ユーザー設定の永続化
- **HTML5/CSS3**: UI構造とスタイリング

### Application Structure

```
custom-dice-roller/
├── index.html          # メインHTMLファイル
├── css/
│   └── style.css       # スタイルシート
├── js/
│   ├── main.js         # アプリケーションエントリーポイント
│   ├── dice.js         # サイコロ3Dモデルとロジック
│   ├── physics.js      # 物理演算の統合
│   ├── scene.js        # Three.jsシーン管理
│   ├── settings.js     # 設定管理とLocalStorage
│   └── ui.js           # UI制御とイベントハンドリング
└── lib/
    ├── three.min.js    # Three.js（CDN経由も可）
    └── cannon.min.js   # Cannon.js（CDN経由も可）
```

## Components and Interfaces

### 1. Scene Manager (`scene.js`)

3D環境の初期化と管理を担当します。

**主要機能:**
- Three.jsシーン、カメラ、レンダラーの初期化
- 緑のカーペット風の平面の作成
- 照明の設定（環境光とディレクショナルライト）
- アニメーションループの管理

**インターフェース:**
```javascript
class SceneManager {
  constructor(container)
  init()
  addObject(mesh)
  removeObject(mesh)
  render()
  resize()
}
```

### 2. Dice Model (`dice.js`)

サイコロの3Dモデルとビジュアル表現を管理します。

**主要機能:**
- 6面体（Box）と8面体（Octahedron）のジオメトリ作成
- 黒いマテリアルの適用
- 各面への白いテキストのレンダリング（Canvas Textureを使用）
- カスタム面値の適用

**インターフェース:**
```javascript
class Dice {
  constructor(type, faceValues) // type: 'd6' or 'd8'
  createMesh()
  updateFaceValues(values)
  getCurrentFace()
  reset()
}
```

**テキストレンダリング:**
各面にテキストを描画するため、Canvas APIを使用してテクスチャを生成します。

### 3. Physics Engine (`physics.js`)

物理演算とサイコロの投げアニメーションを管理します。

**主要機能:**
- Cannon.jsワールドの初期化
- サイコロの物理ボディの作成
- 床（カーペット）の物理ボディの作成
- 投げる動作（初速度と回転の適用）
- 物理シミュレーションとThree.jsメッシュの同期

**インターフェース:**
```javascript
class PhysicsEngine {
  constructor(world)
  init()
  createDiceBody(dice)
  createFloor()
  throwDice(force, torque)
  update(deltaTime)
  isAtRest()
}
```

### 4. Settings Manager (`settings.js`)

ユーザー設定の管理とLocalStorageへの永続化を担当します。

**主要機能:**
- サイコロタイプの保存/読み込み
- 面値のカスタマイズ設定の保存/読み込み
- デフォルト値の管理

**インターフェース:**
```javascript
class SettingsManager {
  saveDiceType(type)
  loadDiceType()
  saveFaceValues(type, values)
  loadFaceValues(type)
  getDefaultFaceValues(type)
}
```

**LocalStorage構造:**
```javascript
{
  "diceType": "d6",
  "d6FaceValues": ["1", "2", "3", "4", "5", "6"],
  "d8FaceValues": ["1", "2", "3", "4", "5", "6", "7", "8"]
}
```

### 5. UI Controller (`ui.js`)

ユーザーインターフェースとイベント処理を管理します。

**主要機能:**
- サイコロタイプ選択UI
- 設定モーダルの表示/非表示
- 面値入力フィールドの動的生成
- 投げるボタンのイベント処理
- リザルト表示の制御

**インターフェース:**
```javascript
class UIController {
  constructor(sceneManager, physicsEngine, settingsManager)
  init()
  showSettings()
  hideSettings()
  updateFaceInputs(type)
  showResult(value)
  hideResult()
  enableRollButton()
  disableRollButton()
}
```

## Data Models

### Dice Configuration

```javascript
{
  type: 'd6' | 'd8',
  faceValues: string[],  // 長さ6または8
  position: { x, y, z },
  rotation: { x, y, z }
}
```

### Physics State

```javascript
{
  position: Vector3,
  quaternion: Quaternion,
  velocity: Vector3,
  angularVelocity: Vector3,
  isAtRest: boolean
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Face value persistence round trip

*For any* valid face values configuration (6 or 8 values), saving to LocalStorage then loading should return the exact same values
**Validates: Requirements 1.5**

### Property 2: Dice type selection consistency

*For any* selected dice type ('d6' or 'd8'), the displayed 3D model should match the selected type with the correct number of faces
**Validates: Requirements 2.2**

### Property 3: Face value application completeness

*For any* set of custom face values, all faces of the rendered dice should display the corresponding custom value (or default if empty)
**Validates: Requirements 1.3, 1.4**

### Property 4: Roll result validity

*For any* dice roll, the result value should be one of the configured face values for that dice type
**Validates: Requirements 3.4**

### Property 5: Physics rest state determinism

*For any* dice throw, the physics simulation should eventually reach a rest state where the dice is no longer moving
**Validates: Requirements 3.3**

### Property 6: Result display synchronization

*For any* completed dice roll, the displayed result value should match the face value of the upward-facing face of the 3D model
**Validates: Requirements 5.1, 5.2**

### Property 7: Empty face value default behavior

*For any* face with an empty string value, the system should display the default numeric face index
**Validates: Requirements 1.4**

## Error Handling

### Input Validation

- **空の面値**: 空文字列の場合、デフォルト値（面番号）を使用
- **無効なサイコロタイプ**: 'd6'または'd8'以外の場合、'd6'をデフォルトとして使用
- **LocalStorage失敗**: 読み込み/書き込みエラー時はデフォルト値を使用し、コンソールに警告を出力

### WebGL/Three.js Errors

- **WebGL非対応ブラウザ**: エラーメッセージを表示し、ユーザーに対応ブラウザの使用を促す
- **レンダリングエラー**: try-catchでキャッチし、フォールバック表示を提供

### Physics Simulation Errors

- **無限ループ防止**: 最大シミュレーション時間（10秒）を設定し、タイムアウト後は強制的に結果を決定
- **NaN/Infinity値**: 物理計算で異常値が発生した場合、サイコロをリセットして再投げを促す

## Testing Strategy

### Unit Testing

テストフレームワーク: **Vitest**（軽量で高速、静的アプリに適している）

**テスト対象:**

1. **SettingsManager**
   - LocalStorageへの保存/読み込み
   - デフォルト値の取得
   - 無効な入力の処理

2. **Dice Model**
   - 面値の更新
   - 現在の上向き面の判定ロジック
   - テクスチャ生成

3. **UI Controller**
   - イベントハンドラーのロジック
   - 入力フィールドの動的生成
   - 状態管理

### Property-Based Testing

テストフレームワーク: **fast-check**（JavaScriptのPBTライブラリ）

各プロパティテストは最低100回の反復を実行します。

**テスト対象:**

1. **Property 1: Face value persistence round trip**
   - ランダムな面値配列を生成し、保存→読み込みの一貫性を検証

2. **Property 2: Dice type selection consistency**
   - ランダムなサイコロタイプを選択し、生成されるジオメトリの面数を検証

3. **Property 3: Face value application completeness**
   - ランダムな面値セットを適用し、すべての面に正しく反映されているか検証

4. **Property 4: Roll result validity**
   - 複数回のロールをシミュレートし、結果が常に設定された面値のいずれかであることを検証

5. **Property 7: Empty face value default behavior**
   - ランダムに空文字列を含む面値セットを生成し、デフォルト値が正しく適用されるか検証

### Integration Testing

- **3Dレンダリングパイプライン**: シーン→サイコロ→物理演算の統合テスト
- **ユーザーフロー**: 設定→投げる→結果表示の完全なフローテスト

### Manual Testing

- **ビジュアル検証**: 黒いサイコロに白い文字が正しく表示されるか
- **アニメーション品質**: 60FPSで滑らかに動作するか
- **レスポンシブ対応**: 異なる画面サイズでの表示確認
- **ブラウザ互換性**: Chrome、Firefox、Safari、Edgeでの動作確認

## Performance Considerations

- **テクスチャキャッシング**: 面値が変更されない限り、Canvasテクスチャを再利用
- **物理演算の最適化**: サイコロが静止したら物理シミュレーションを一時停止
- **レンダリング最適化**: requestAnimationFrameを使用し、不要な再描画を避ける
- **アセット最小化**: Three.jsとCannon.jsの最小化版を使用

## Deployment

静的ファイルとして以下のプラットフォームにデプロイ可能:
- GitHub Pages
- Netlify
- Vercel
- AWS S3 + CloudFront

すべてのアセットは相対パスで参照し、CDNからライブラリを読み込むことで、シンプルなデプロイを実現します。
