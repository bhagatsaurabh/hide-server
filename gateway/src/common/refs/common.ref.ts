export class CommonRef {
  private static instanceId: string;

  static getInstanceId() {
    return this.instanceId;
  }
  static setInstanceId(instanceId: string) {
    this.instanceId = instanceId;
  }
}
