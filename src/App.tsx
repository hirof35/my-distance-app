import { useEffect, useState } from 'react';
import { Geolocation } from '@capacitor/geolocation';
import { Motion } from '@capacitor/motion';
import { Capacitor } from '@capacitor/core'; // ← 追加：実行環境の判定用
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface GPSCoordinate {
  latitude: number;
  longitude: number;
}

interface MeasurementPoint {
  coords: GPSCoordinate;
  azimuth: number;
}

export default function App() {
  const [map, setMap] = useState<L.Map | null>(null);
  const [currentMarker, setCurrentMarker] = useState<L.Marker | null>(null);
  const [targetMarker, setTargetMarker] = useState<L.Marker | null>(null);
  const [lines, setLines] = useState<L.Polyline[]>([]);
  const [distance, setDistance] = useState<number | null>(null);
  const [currentCoords, setCurrentCoords] = useState<GPSCoordinate | null>(null);
  const [heading, setHeading] = useState<number>(0);
  const [pointA, setPointA] = useState<MeasurementPoint | null>(null);
  const [pointB, setPointB] = useState<MeasurementPoint | null>(null);

  useEffect(() => {
    // 初期の中心地（東京タワー付近）
    const defaultCenter: L.LatLngExpression = [35.6586, 139.7454];
    const mapInstance = L.map('map-container').setView(defaultCenter, 16);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
    }).addTo(mapInstance);

    const marker = L.marker(defaultCenter).addTo(mapInstance).bindPopup('現在地（GPS受信中）');

    setMap(mapInstance);
    setCurrentMarker(marker);

    // センサー・GPSの初期化
    initSensors(mapInstance, marker);

    return () => {
      mapInstance.remove();
    };
  }, []);

  // 📡 GPSと方位センサーの初期化（Web/ネイティブの切り分け）
  const initSensors = async (mapInstance: L.Map, marker: L.Marker) => {
    const isNative = Capacitor.isNativePlatform();

    // --- 1. GPS位置情報の取得 ---
    if (isNative) {
      // スマホ（ネイティブ）環境の場合
      try {
        await Geolocation.requestPermissions();
        await Geolocation.watchPosition({ enableHighAccuracy: true }, (position) => {
          if (position) {
            updateLocation(position.coords.latitude, position.coords.longitude, mapInstance, marker);
          }
        });
      } catch (e) {
        console.error('ネイティブGPSの初期化に失敗:', e);
      }
    } else {
      // PCブラウザ（Web）環境の場合
      if ('geolocation' in navigator) {
        navigator.geolocation.watchPosition(
          (position) => {
            updateLocation(position.coords.latitude, position.coords.longitude, mapInstance, marker);
          },
          (err) => console.error('ブラウザGPSエラー:', err),
          { enableHighAccuracy: true }
        );
      } else {
        alert('このブラウザは位置情報をサポートしていません。');
      }
    }

    // --- 2. 方位（コンパス）センサーの取得 ---
    if (isNative) {
      try {
        await Motion.addListener('orientation', (event) => {
          if (event.alpha !== null) {
            let azimuth = (360 - event.alpha) % 360;
            setHeading(azimuth);
          }
        });
      } catch (e) {
        console.error('ネイティブコンパスの初期化に失敗:', e);
      }
    } else {
      console.log('Web環境のためコンパスは利用できません。手動入力を有効にします。');
    }
  };

  // 位置情報更新の共通処理
  const updateLocation = (lat: number, lng: number, mapInstance: L.Map, marker: L.Marker) => {
    setCurrentCoords({ latitude: lat, longitude: lng });
    const pos: L.LatLngExpression = [lat, lng];
    marker.setLatLng(pos);
    mapInstance.setView(pos);
  };

  // 測定アクション
  /*const recordPointA = () => {
    if (!currentCoords || !map) return alert('GPS信号を受信中、または位置情報の利用を許可してください。');
    const pA = { coords: { ...currentCoords }, azimuth: heading };
    setPointA(pA);

    L.marker([pA.coords.latitude, pA.coords.longitude], { title: '地点A' })
      .addTo(map)
      .bindPopup(`測定地点A (方位: ${Math.round(heading)}°)`)
      .openPopup();
  };*/
  // 測定アクション（PCテスト用に現在地を少しずらす改造版）
  const recordPointA = () => {
    if (!map) return alert('地図の初期化を待ってください');
    
    // 現在地がまだ取れていない場合は、仮の座標を設定（東京タワー付近）
    const baseCoords = currentCoords || { latitude: 35.6586, longitude: 139.7454 };
    
    // 点Aは基準点
    const pA = { coords: baseCoords, azimuth: heading };
    setPointA(pA);

    L.marker([pA.coords.latitude, pA.coords.longitude], { title: '地点A' })
      .addTo(map)
      .bindPopup(`測定地点A (方位: ${Math.round(heading)}°)`)
      .openPopup();
  };

  const recordPointBAndCalculate = () => {
    if (!map || !pointA) return alert('先に地点Aを設定してください。');

    // ★PCテスト用：地点Aから「東に約30メートル」強制的に離れた場所を地点Bとする
    const mockPointBCoords = {
      latitude: pointA.coords.latitude,
      longitude: pointA.coords.longitude + 0.0003 // 経度を少しプラス
    };

    const pB = { coords: mockPointBCoords, azimuth: heading };
    setPointB(pB);

    L.marker([pB.coords.latitude, pB.coords.longitude], { title: '地点B' })
      .addTo(map)
      .bindPopup(`測定地点B (方位: ${Math.round(heading)}°)`);

    try {
        const target = calculateTarget(pointA, pB);
  
        if (targetMarker) map.removeLayer(targetMarker);
        lines.forEach((line) => map.removeLayer(line));
  
        const newTargetMarker = L.marker([target.latitude, target.longitude])
          .addTo(map)
          .bindPopup('対象物の推定位置')
          .openPopup();
        setTargetMarker(newTargetMarker);
  
        const lineA = L.polyline([[pointA.coords.latitude, pointA.coords.longitude], [target.latitude, target.longitude]], { color: 'blue' }).addTo(map);
        const lineB = L.polyline([[pB.coords.latitude, pB.coords.longitude], [target.latitude, target.longitude]], { color: 'green' }).addTo(map);
        setLines([lineA, lineB]);
  
        // ======= 👇 ここから追加：地点Aから対象物までの距離を計算 =======
        const EARTH_RADIUS = 6378137;
        const latRad1 = pointA.coords.latitude * (Math.PI / 180);
        const latRad2 = target.latitude * (Math.PI / 180);
        const dy = (latRad2 - latRad1) * EARTH_RADIUS;
        const dx = (target.longitude - pointA.coords.longitude) * (Math.PI / 180) * EARTH_RADIUS * Math.cos(latRad1);
        
        // 三平方の定理で直線距離を出す
        const calculatedDistance = Math.sqrt(dx * dx + dy * dy);
        setDistance(calculatedDistance);
        // ======= 👆 ここまで追加 =======
    } catch (error) {
      alert(error instanceof Error ? error.message : '計算に失敗しました');
    }
  };

  /*const recordPointBAndCalculate = () => {
    if (!currentCoords || !map) return alert('GPS信号を受信中...');
    if (!pointA) return alert('先に地点Aを設定してください。');

    const pB = { coords: { ...currentCoords }, azimuth: heading };
    setPointB(pB);

    L.marker([pB.coords.latitude, pB.coords.longitude], { title: '地点B' })
      .addTo(map)
      .bindPopup(`測定地点B (方位: ${Math.round(heading)}°)`);

    try {
      const target = calculateTarget(pointA, pB);

      if (targetMarker) map.removeLayer(targetMarker);
      lines.forEach((line) => map.removeLayer(line));

      const newTargetMarker = L.marker([target.latitude, target.longitude])
        .addTo(map)
        .bindPopup('対象物の推定位置')
        .openPopup();
      setTargetMarker(newTargetMarker);

      const lineA = L.polyline([[pointA.coords.latitude, pointA.coords.longitude], [target.latitude, target.longitude]], { color: 'blue' }).addTo(map);
      const lineB = L.polyline([[pB.coords.latitude, pB.coords.longitude], [target.latitude, target.longitude]], { color: 'green' }).addTo(map);
      setLines([lineA, lineB]);

    } catch (error) {
      alert(error instanceof Error ? error.message : '計算に失敗しました');
    }
  };*/

  // 三角測量計算コア
  const calculateTarget = (pA: MeasurementPoint, pB: MeasurementPoint): GPSCoordinate => {
    const EARTH_RADIUS = 6378137;
    const latRad1 = pA.coords.latitude * (Math.PI / 180);
    const latRad2 = pB.coords.latitude * (Math.PI / 180);
    const y2 = (latRad2 - latRad1) * EARTH_RADIUS;
    const x2 = (pB.coords.longitude - pA.coords.longitude) * (Math.PI / 180) * EARTH_RADIUS * Math.cos(latRad1);

    const theta1 = ((90 - pA.azimuth + 360) % 360) * (Math.PI / 180);
    const theta2 = ((90 - pB.azimuth + 360) % 360) * (Math.PI / 180);

    const m1 = Math.tan(theta1);
    const m2 = Math.tan(theta2);

    if (Math.abs(m1 - m2) < 1e-5) {
      throw new Error("2つの視線が平行に近いため、交点を計算できません。");
    }

    const targetX = (y2 - m2 * x2) / (m1 - m2);
    const targetY = m1 * targetX;

    const targetLat = pA.coords.latitude + (targetY / EARTH_RADIUS) * (180 / Math.PI);
    const targetLon = pA.coords.longitude + (targetX / (EARTH_RADIUS * Math.cos(latRad1))) * (180 / Math.PI);

    return { latitude: targetLat, longitude: targetLon };
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'sans-serif' }}>
      <div id="map-container" style={{ flex: 1, width: '100%' }}></div>

      <div style={{ padding: '20px', background: '#f5f5f5', textAlign: 'center', boxShadow: '0 -2px 10px rgba(0,0,0,0.1)' }}>
        <p style={{ fontSize: '18px', fontWeight: 'bold', margin: '0 0 5px 0' }}>
          現在の方位: {Math.round(heading)}°
        </p>
        {/* ======= 👇 ここを追加 ======= */}
        {distance !== null && (
          <p style={{ fontSize: '20px', fontWeight: 'bold', color: '#ff3b30', margin: '10px 0' }}>
            対象物までの推定距離 (地点Aから): {distance.toFixed(1)} メートル
          </p>
        )}
        {/* ======= 👆 ここを追加 ======= */}
        {/* PCテスト用の方位手動スライダー（スマホではコンパスが連動します） */}
        {!Capacitor.isNativePlatform() && (
          <div style={{ marginBottom: '15px' }}>
            <label style={{ fontSize: '12px', color: '#666' }}>PCテスト用方位シミュレーター: </label>
            <input 
              type="range" min="0" max="359" value={heading} 
              onChange={(e) => setHeading(Number(e.target.value))}
              style={{ width: '60%', verticalAlign: 'middle', marginLeft: '10px' }}
            />
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-around' }}>
          <button onClick={recordPointA} style={{ padding: '12px 20px', fontSize: '16px', background: '#007AFF', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>
            1. 地点Aを設定
          </button>
          <button onClick={recordPointBAndCalculate} disabled={!pointA} style={{ padding: '12px 20px', fontSize: '16px', background: pointA ? '#34C759' : '#A9A9A9', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>
            2. 地点B & 計算
          </button>
        </div>
      </div>
    </div>
  );
}