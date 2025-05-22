export class CommonRef {
  private static instanceId: string;

  static setInstanceId(instanceId: string) {
    this.instanceId = instanceId;
  }

  static getInstanceId(): string {
    return this.instanceId;
  }
}
