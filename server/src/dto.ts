import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateApplicationDto {
  @IsInt()
  teamId: number;

  @IsInt()
  boxId: number;

  @IsString()
  @IsNotEmpty()
  purpose: string;

  @IsDateString()
  plannedStart: string;

  @IsDateString()
  plannedEnd: string;
}

export class ApproveDto {
  @IsString()
  @IsNotEmpty()
  meterCode: string;

  @IsNumber()
  @Min(0)
  initialReading: number;

  @IsString()
  @IsNotEmpty()
  electrician: string;

  /** 接线安全已验收，必须为 true 才能开通 */
  @IsBoolean()
  wiringConfirmed: boolean;

  /** 可选：补录历史时间（默认当前时间） */
  @IsOptional()
  @IsDateString()
  at?: string;
}

export class RejectDto {
  @IsString()
  @IsNotEmpty()
  electrician: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class SwapMeterDto {
  @IsNumber()
  @Min(0)
  oldFinal: number;

  @IsString()
  @IsNotEmpty()
  newCode: string;

  @IsNumber()
  @Min(0)
  newInitial: number;

  @IsString()
  @IsNotEmpty()
  electrician: string;

  @IsOptional()
  @IsDateString()
  at?: string;
}

export class FinalizeDto {
  @IsNumber()
  @Min(0)
  value: number;

  @IsString()
  @IsNotEmpty()
  electrician: string;

  /** 末次读数异常（倒退/跃升）时，电工现场确认后置 true */
  @IsOptional()
  @IsBoolean()
  confirmAbnormal?: boolean;

  @IsOptional()
  @IsDateString()
  at?: string;
}

export class DisconnectDto {
  @IsString()
  @IsNotEmpty()
  electrician: string;
}

export class CreateReadingDto {
  @IsNumber()
  @Min(0)
  value: number;

  @IsString()
  @IsNotEmpty()
  recordedBy: string;

  @IsOptional()
  @IsDateString()
  recordedAt?: string;
}

export class ReviewDto {
  @IsBoolean()
  approve: boolean;

  @IsString()
  @IsNotEmpty()
  reviewedBy: string;

  @IsOptional()
  @IsString()
  note?: string;
}
