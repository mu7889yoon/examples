const map = L.map('map').setView([35.0116, 135.7681], 12);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

function mapStatus(status) {
    switch(status) {
        case 'crowded':
            return 'crowded';        
        default:
            return 'empty';
    }
}

function getStatusColor(status) {
    const mappedStatus = mapStatus(status);
    switch(mappedStatus) {
        case 'empty':
            return '#007bff';
        case 'crowded':
            return '#dc3545';
        default:
            return '#007bff';
    }
}

function getStatusClass(status) {
    const mappedStatus = mapStatus(status);
    return `status-${mappedStatus}`;
}

Promise.all([
    fetch('data/prefectures.geojson').then(response => response.json()),
    fetch('data/prefectures-status.json').then(response => response.json()),        
])
.then(([geojsonData, statusData]) => {
    const statusMap = {};
    statusData.statuses.forEach(item => {
        statusMap[item.name] = {
            status: item.status
        };
    });
    
    geojsonData.features.forEach(feature => {
        const name = feature.properties.name;
        if (statusMap[name]) {
            feature.properties.status = statusMap[name].status;
        }
    });

    const geojsonLayer = L.geoJSON(geojsonData, {            
            style: function (feature) {                
                const status = feature.properties.status;
                return {
                    fillColor: getStatusColor(status),
                    weight: 2,
                    opacity: 1,
                    color: '#fff',
                    dashArray: '3',
                    fillOpacity: 0.3
                };
            },
            onEachFeature: function (feature, layer) {                
                const props = feature.properties;
                const mappedStatus = mapStatus(props.status);
                const statusClass = getStatusClass(props.status);
                            
                const statusLabel = mappedStatus === 'empty' ? '空いてる' : '混んでる';
                
                const popupContent = `
                    <div class="popup-content">
                        <div class="popup-title">${props.name}</div>
                        <div class="popup-status ${statusClass}">${statusLabel}</div>
                    </div>
                `;
                
                layer.bindPopup(popupContent);
            }
        });

        geojsonLayer.addTo(map);
        
        map.fitBounds(geojsonLayer.getBounds());
        
        window.filterByStatus = function() {
            const emptyChecked = document.getElementById('filter-empty').checked;
            const crowdedChecked = document.getElementById('filter-crowded').checked;
            
            geojsonLayer.eachLayer(function(layer) {
                const originalStatus = layer.feature.properties.status;
                const mappedStatus = mapStatus(originalStatus);
                let shouldShow = false;
                
                if (mappedStatus === 'empty' && emptyChecked) shouldShow = true;
                if (mappedStatus === 'crowded' && crowdedChecked) shouldShow = true;
                
                if (shouldShow) {
                    map.addLayer(layer);
                } else {
                    map.removeLayer(layer);
                }
            });
        };
        
        window.resetFilters = function() {
            document.getElementById('filter-empty').checked = true;
            document.getElementById('filter-crowded').checked = true;
            
            geojsonLayer.eachLayer(function(layer) {
                map.addLayer(layer);
            });
        };
    })
    .catch(error => {        
        alert('データの読み込みに失敗しました。');
    });
