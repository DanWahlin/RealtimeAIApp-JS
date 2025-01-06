export class CarDescriptor {
    make: string | null = null;
    model: string | null = null;
    year: number | null = null;
    mileage: number | null = null;
    conditionNotes: string[] = [];
    tires: TireStatuses = new TireStatuses();
  
    constructor(init?: Partial<CarDescriptor>) {
      Object.assign(this, init);
    }
  }
  
  export enum TireStatus {
    NeedsReplacement = "NeedsReplacement",
    Worn = "Worn",
    Good = "Good",
    New = "New",
  }
  
  export class TireStatuses {
    frontLeft: TireStatus | null = null;
    frontRight: TireStatus | null = null;
    backLeft: TireStatus | null = null;
    backRight: TireStatus | null = null;
  
    constructor(init?: Partial<TireStatuses>) {
      Object.assign(this, init);
    }
  }