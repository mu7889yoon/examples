"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const cdk = __importStar(require("aws-cdk-lib"));
const assertions_1 = require("aws-cdk-lib/assertions");
const ec2_nested_virtualization_gnu_hurd_stack_1 = require("../lib/ec2-nested-virtualization-gnu-hurd-stack");
test('Instance launch request enables nested virtualization on c8i.large', () => {
    const app = new cdk.App();
    const stack = new ec2_nested_virtualization_gnu_hurd_stack_1.Ec2NestedVirtualizationGnuHurdStack(app, 'TestStack');
    const template = assertions_1.Template.fromStack(stack);
    template.resourceCountIs('AWS::EC2::LaunchTemplate', 0);
    template.resourceCountIs('AWS::CloudFormation::CustomResource', 1);
    template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
        InstanceType: 'c8i.large',
        NestedVirtualization: 'enabled',
        ImageId: '{{resolve:ssm:/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id}}',
    });
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
        GroupDescription: 'Session Manager only. No inbound access.',
        SecurityGroupIngress: assertions_1.Match.absent(),
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZWMyLW5lc3RlZC12aXJ0dWFsaXphdGlvbi1nbnUtaHVyZC50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiZWMyLW5lc3RlZC12aXJ0dWFsaXphdGlvbi1nbnUtaHVyZC50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBQ25DLHVEQUF5RDtBQUN6RCw4R0FBc0c7QUFFdEcsSUFBSSxDQUFDLG9FQUFvRSxFQUFFLEdBQUcsRUFBRTtJQUM5RSxNQUFNLEdBQUcsR0FBRyxJQUFJLEdBQUcsQ0FBQyxHQUFHLEVBQUUsQ0FBQztJQUMxQixNQUFNLEtBQUssR0FBRyxJQUFJLDhFQUFtQyxDQUFDLEdBQUcsRUFBRSxXQUFXLENBQUMsQ0FBQztJQUN4RSxNQUFNLFFBQVEsR0FBRyxxQkFBUSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUUzQyxRQUFRLENBQUMsZUFBZSxDQUFDLDBCQUEwQixFQUFFLENBQUMsQ0FBQyxDQUFDO0lBQ3hELFFBQVEsQ0FBQyxlQUFlLENBQUMscUNBQXFDLEVBQUUsQ0FBQyxDQUFDLENBQUM7SUFDbkUsUUFBUSxDQUFDLHFCQUFxQixDQUFDLHFDQUFxQyxFQUFFO1FBQ3BFLFlBQVksRUFBRSxXQUFXO1FBQ3pCLG9CQUFvQixFQUFFLFNBQVM7UUFDL0IsT0FBTyxFQUNMLG9HQUFvRztLQUN2RyxDQUFDLENBQUM7SUFFSCxRQUFRLENBQUMscUJBQXFCLENBQUMseUJBQXlCLEVBQUU7UUFDeEQsZ0JBQWdCLEVBQUUsMENBQTBDO1FBQzVELG9CQUFvQixFQUFFLGtCQUFLLENBQUMsTUFBTSxFQUFFO0tBQ3JDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IE1hdGNoLCBUZW1wbGF0ZSB9IGZyb20gJ2F3cy1jZGstbGliL2Fzc2VydGlvbnMnO1xuaW1wb3J0IHsgRWMyTmVzdGVkVmlydHVhbGl6YXRpb25HbnVIdXJkU3RhY2sgfSBmcm9tICcuLi9saWIvZWMyLW5lc3RlZC12aXJ0dWFsaXphdGlvbi1nbnUtaHVyZC1zdGFjayc7XG5cbnRlc3QoJ0luc3RhbmNlIGxhdW5jaCByZXF1ZXN0IGVuYWJsZXMgbmVzdGVkIHZpcnR1YWxpemF0aW9uIG9uIGM4aS5sYXJnZScsICgpID0+IHtcbiAgY29uc3QgYXBwID0gbmV3IGNkay5BcHAoKTtcbiAgY29uc3Qgc3RhY2sgPSBuZXcgRWMyTmVzdGVkVmlydHVhbGl6YXRpb25HbnVIdXJkU3RhY2soYXBwLCAnVGVzdFN0YWNrJyk7XG4gIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcblxuICB0ZW1wbGF0ZS5yZXNvdXJjZUNvdW50SXMoJ0FXUzo6RUMyOjpMYXVuY2hUZW1wbGF0ZScsIDApO1xuICB0ZW1wbGF0ZS5yZXNvdXJjZUNvdW50SXMoJ0FXUzo6Q2xvdWRGb3JtYXRpb246OkN1c3RvbVJlc291cmNlJywgMSk7XG4gIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpDbG91ZEZvcm1hdGlvbjo6Q3VzdG9tUmVzb3VyY2UnLCB7XG4gICAgSW5zdGFuY2VUeXBlOiAnYzhpLmxhcmdlJyxcbiAgICBOZXN0ZWRWaXJ0dWFsaXphdGlvbjogJ2VuYWJsZWQnLFxuICAgIEltYWdlSWQ6XG4gICAgICAne3tyZXNvbHZlOnNzbTovYXdzL3NlcnZpY2UvY2Fub25pY2FsL3VidW50dS9zZXJ2ZXIvMjQuMDQvc3RhYmxlL2N1cnJlbnQvYW1kNjQvaHZtL2Vicy1ncDMvYW1pLWlkfX0nLFxuICB9KTtcblxuICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6RUMyOjpTZWN1cml0eUdyb3VwJywge1xuICAgIEdyb3VwRGVzY3JpcHRpb246ICdTZXNzaW9uIE1hbmFnZXIgb25seS4gTm8gaW5ib3VuZCBhY2Nlc3MuJyxcbiAgICBTZWN1cml0eUdyb3VwSW5ncmVzczogTWF0Y2guYWJzZW50KCksXG4gIH0pO1xufSk7XG4iXX0=