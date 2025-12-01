const { Authenticator } = require('cognito-at-edge');

const authenticator = new Authenticator({  
  region: 'ap-northeast-1', // user pool region
  userPoolId: 'ap-northeast-1_RFoibbicq', // user pool ID
  userPoolAppId: '75820qukl1ir078q34la2lgh4c', // user pool app client ID
  userPoolDomain: 'ap-northeast-1rfoibbicq.auth.ap-northeast-1.amazoncognito.com', // user pool domain
  userPoolAppSecret: 'ibd3d31851mtgaj5pmrlspab693n5vv8n9k6phcpka3ivk77rjk',
});

exports.handler = async (request) => authenticator.handle(request);