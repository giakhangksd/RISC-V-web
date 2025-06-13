// simulator.js
// Mô phỏng việc thực thi mã máy RISC-V, bao gồm RV32I, RV32M và các lệnh RV32F cơ bản.
// --- TileLink-UL Memory Model ---
class TileLinkULMemory {
    constructor() {
        this.mem = {}; // Bộ nhớ chính, truy cập theo địa chỉ byte
    }

    readByte(address) {
        const b = this.mem[address | 0];
        if (b === undefined) throw new Error(`TileLinkUL: Read byte error at 0x${address.toString(16)}`);
        return b;
    }

    writeByte(address, value) {
        this.mem[address | 0] = value & 0xFF;
    }

    readWord(address) {
        const addr = address | 0;
        const b0 = this.readByte(addr);
        const b1 = this.readByte(addr + 1);
        const b2 = this.readByte(addr + 2);
        const b3 = this.readByte(addr + 3);
        return (b3 << 24) | (b2 << 16) | (b1 << 8) | b0;
    }
    
    writeWord(address, value) {
        const addr = address | 0;
        this.writeByte(addr, value & 0xFF);
        this.writeByte(addr + 1, (value >> 8) & 0xFF);
        this.writeByte(addr + 2, (value >> 16) & 0xFF);
        this.writeByte(addr + 3, (value >> 24) & 0xFF);
    }

    loadMemoryMap(memoryMap) {
        this.mem = { ...memoryMap };
    }

    reset() {
        this.mem = {};
    }
}

// --- Simulator ---
export const simulator = {
    registers: new Int32Array(32),
    fregisters: new Float32Array(32),
    tilelinkMem: new TileLinkULMemory(),
    pc: 0,
    isRunning: false,
    instructionCount: 0,
    maxSteps: 1000000,

    resetRegisters() {
        this.registers.fill(0);
        this.fregisters.fill(0.0);
        this.pc = 0;
    },

    resetMemory() {
        this.tilelinkMem.reset();
    },
    reset() {
        this.resetRegisters();
        this.resetMemory();
        this.isRunning = false;
        this.instructionCount = 0;
    },

    loadProgram(programData) {
        this.reset();
        if (programData.memory) {
            this.tilelinkMem.loadMemoryMap(programData.memory);
        } else {
            console.warn("No memory map provided by assembler to load.");
        }
        this.pc = programData.startAddress || 0;
    },

    run() {
        this.isRunning = true;
        this.instructionCount = 0;
        const runLoop = () => {
            if (!this.isRunning) {
                if (typeof window !== 'undefined' && window.updateUIGlobally) window.updateUIGlobally();
                return;
            }
            if (this.instructionCount >= this.maxSteps) {
                this.isRunning = false;
                const message = `Simulation stopped: Maximum instruction steps (${this.maxSteps}) reached.`;
                console.warn(message);
                alert(message);
                if (typeof window !== 'undefined' && window.updateUIGlobally) window.updateUIGlobally();
                return;
            }
            try {
                this.step();
                if (this.isRunning) {
                    setTimeout(runLoop, 0);
                } else {
                    if (typeof window !== 'undefined' && window.updateUIGlobally) window.updateUIGlobally();
                }
            } catch (error) {
                this.isRunning = false;
                console.error("Error during simulation run:", error.message, error.stack);
                alert(`Runtime Error: ${error.message}`);
                if (typeof window !== 'undefined' && window.updateUIGlobally) window.updateUIGlobally();
            }
        };
        setTimeout(runLoop, 0);
    },

    stop() {
        this.isRunning = false;
    },

    step() {
        if (this.pc === null || this.pc === undefined) {
            throw new Error("Cannot execute step: Program Counter (PC) is not set or is invalid.");
        }
        const currentPcForStep = this.pc;
        const instructionWord = this.fetch(currentPcForStep);
        if (instructionWord === undefined) {
            throw new Error(`Failed to fetch instruction at address 0x${currentPcForStep.toString(16).padStart(8, '0')}. Halting.`);
        }
        const decoded = this.decode(instructionWord);
        if (decoded.opName === 'UNKNOWN') {
            throw new Error(`Could not decode instruction word: 0x${instructionWord.toString(16).padStart(8, '0')} at PC 0x${currentPcForStep.toString(16).padStart(8, '0')}`);
        }
        const executionResult = this.execute(decoded);
        if (executionResult && executionResult.nextPc !== undefined) {
            this.pc = executionResult.nextPc;
        } else {
            this.pc = currentPcForStep + 4;
        }
        this.registers[0] = 0;
        this.instructionCount++;
        if (typeof window !== 'undefined' && window.updateUIGlobally) {
            window.updateUIGlobally();
        }
    },
    // --- TileLink-UL FETCH ---
    fetch(address) {
        const addrInt = parseInt(address);
        if (isNaN(addrInt)) {
            console.error(`Fetch Error: Invalid address format "${address}"`);
            return undefined;
        }
        try {
            return this.tilelinkMem.readWord(addrInt);
        } catch (e) {
            console.error(e.message);
            return undefined;
        }
    },

    // DECODE: Giải mã từ lệnh 32-bit thành các trường và tên lệnh
    decode(instructionWord) {
        // Trích xuất các trường bit cơ bản từ từ lệnh
        const opcode = instructionWord & 0x7F;          // 7 bit opcode
        const rd = (instructionWord >> 7) & 0x1F;       // 5 bit thanh ghi đích
        const funct3 = (instructionWord >> 12) & 0x7;   // 3 bit funct3
        const rs1 = (instructionWord >> 15) & 0x1F;     // 5 bit thanh ghi nguồn 1
        const rs2 = (instructionWord >> 20) & 0x1F;     // 5 bit thanh ghi nguồn 2 (hoặc fmt cho FP)
        const funct7 = (instructionWord >> 25) & 0x7F;  // 7 bit funct7 (hoặc 1 phần cho lệnh FP)

        // Chuyển các trường sang dạng chuỗi nhị phân để dễ so khớp
        const opcodeBin = opcode.toString(2).padStart(7, '0');
        const funct3Bin = funct3.toString(2).padStart(3, '0');
        const funct7Bin = funct7.toString(2).padStart(7, '0');

        let imm = 0;        // Giá trị immediate (nếu có)
        let type = null;    // Loại lệnh (R, I, S, B, U, J, R-FP, I-FP, S-FP, etc.)
        let opName = "UNKNOWN"; // Tên lệnh (ví dụ: ADD, LW, FADD.S)
        let rm = funct3;    // Chế độ làm tròn (rounding mode), thường từ funct3 cho lệnh FP

        // Bảng định nghĩa các lệnh và cách giải mã chúng
        // Nên đồng bộ với bảng `opcodes` trong `assembler.js`
        const instructionFormats = {
            // ----- RV32I Base -----
            "ADD":   { type: "R", opcode: "0110011", funct3: "000", funct7: "0000000" },
            "SUB":   { type: "R", opcode: "0110011", funct3: "000", funct7: "0100000" },
            "SLL":   { type: "R", opcode: "0110011", funct3: "001", funct7: "0000000" },
            "SLT":   { type: "R", opcode: "0110011", funct3: "010", funct7: "0000000" },
            "SLTU":  { type: "R", opcode: "0110011", funct3: "011", funct7: "0000000" },
            "XOR":   { type: "R", opcode: "0110011", funct3: "100", funct7: "0000000" },
            "SRL":   { type: "R", opcode: "0110011", funct3: "101", funct7: "0000000" },
            "SRA":   { type: "R", opcode: "0110011", funct3: "101", funct7: "0100000" },
            "OR":    { type: "R", opcode: "0110011", funct3: "110", funct7: "0000000" },
            "AND":   { type: "R", opcode: "0110011", funct3: "111", funct7: "0000000" },
            "ADDI":  { type: "I", opcode: "0010011", funct3: "000" },
            "SLTI":  { type: "I", opcode: "0010011", funct3: "010" },
            "SLTIU": { type: "I", opcode: "0010011", funct3: "011" },
            "XORI":  { type: "I", opcode: "0010011", funct3: "100" },
            "ORI":   { type: "I", opcode: "0010011", funct3: "110" },
            "ANDI":  { type: "I", opcode: "0010011", funct3: "111" },
            "SLLI":  { type: "I-shamt", opcode: "0010011", funct3: "001", funct7Matcher: "0000000" },
            "SRLI":  { type: "I-shamt", opcode: "0010011", funct3: "101", funct7Matcher: "0000000" },
            "SRAI":  { type: "I-shamt", opcode: "0010011", funct3: "101", funct7Matcher: "0100000" },
            "LW":    { type: "I", opcode: "0000011", funct3: "010" },
            "LH":    { type: "I", opcode: "0000011", funct3: "001" },
            "LB":    { type: "I", opcode: "0000011", funct3: "000" },
            "LHU":   { type: "I", opcode: "0000011", funct3: "101" },
            "LBU":   { type: "I", opcode: "0000011", funct3: "100" },
            "SW":    { type: "S", opcode: "0100011", funct3: "010" },
            "SH":    { type: "S", opcode: "0100011", funct3: "001" },
            "SB":    { type: "S", opcode: "0100011", funct3: "000" },
            "LUI":   { type: "U", opcode: "0110111" },
            "AUIPC": { type: "U", opcode: "0010111" },
            "JAL":   { type: "J", opcode: "1101111" },
            "JALR":  { type: "I", opcode: "1100111", funct3: "000" },
            "BEQ":   { type: "B", opcode: "1100011", funct3: "000" },
            "BNE":   { type: "B", opcode: "1100011", funct3: "001" },
            "BLT":   { type: "B", opcode: "1100011", funct3: "100" },
            "BGE":   { type: "B", opcode: "1100011", funct3: "101" },
            "BLTU":  { type: "B", opcode: "1100011", funct3: "110" },
            "BGEU":  { type: "B", opcode: "1100011", funct3: "111" },
            "ECALL": { type: "I", opcode: "1110011", funct3: "000", immFieldMatcher: "000000000000" },
            "EBREAK":{ type: "I", opcode: "1110011", funct3: "000", immFieldMatcher: "000000000001" },
            // ----- RV32M Extension -----
            "MUL":   { type: "R", opcode: "0110011", funct3: "000", funct7: "0000001" },
            "MULH":  { type: "R", opcode: "0110011", funct3: "001", funct7: "0000001" },
            "MULHSU":{ type: "R", opcode: "0110011", funct3: "010", funct7: "0000001" },
            "MULHU": { type: "R", opcode: "0110011", funct3: "011", funct7: "0000001" },
            "DIV":   { type: "R", opcode: "0110011", funct3: "100", funct7: "0000001" },
            "DIVU":  { type: "R", opcode: "0110011", funct3: "101", funct7: "0000001" },
            "REM":   { type: "R", opcode: "0110011", funct3: "110", funct7: "0000001" },
            "REMU":  { type: "R", opcode: "0110011", funct3: "111", funct7: "0000001" },

            // ----- RV32F Standard Extension (Single-Precision Floating-Point) -----
            // Opcode cho FLW/FSW khác với LW/SW
            "FLW":   { type: "I-FP", opcode: "0000111", funct3: "010" }, // rd(fp), rs1(int), imm
            "FSW":   { type: "S-FP", opcode: "0100111", funct3: "010" }, // rs1(int), rs2(fp), imm

            // Opcode chung cho nhiều lệnh FP R-type: 1010011
            // funct7[6:2] (thường gọi là funct5) + rs2[1:0] (fmt=00 for .S) hoặc funct7 đầy đủ xác định phép toán
            // funct3 chứa rounding mode (rm)
            // Đối với .S, rs2 field bits [26:25] (fmt) là '00'.
            // Chúng ta sẽ dùng funct7 để xác định phép toán chính
            "FADD.S":  { type: "R-FP", opcode: "1010011", funct3: "000", funct7: "0000000" },
            "FSUB.S":  { type: "R-FP", opcode: "1010011", funct3: "000", funct7: "0000100" /*fmt=00*/ },
            "FMUL.S":  { type: "R-FP", opcode: "1010011", funct3: "000", funct7: "0001000" /*fmt=00*/ },
            "FDIV.S":  { type: "R-FP", opcode: "1010011", funct3: "000", funct7: "0001100" /*fmt=00*/ },

            // Conversions: dest_is_int, src1_is_fp hoặc ngược lại sẽ giúp execute biết thanh ghi nào là int/fp
            // rs2 field bits [26:25] (fmt) là '00' cho nguồn .S, hoặc rs2 là thanh ghi nguồn cho nguồn .W/.WU
            // Đối với fcvt.w.s, rs2 chứa chỉ số thanh ghi KHÔNG dùng, chỉ có fmt ở bit 26-25.
            // funct7[6:0] = 1100000 for FCVT.W.S/FCVT.WU.S (bit rs2[0] = 0 for W, 1 for WU)
            // funct7[6:0] = 1101000 for FCVT.S.W/FCVT.S.WU (bit rs2[0] = 0 for W, 1 for WU)
            "FCVT.W.S":  { type: "R-FP-CVT", opcode: "1010011", funct7: "1100000", rs2_subfield: "00000" /*src_fmt=S, type W*/}, // rd(int), rs1(fp), rm in funct3
            "FCVT.S.W":  { type: "R-FP-CVT", opcode: "1010011", funct7: "1101000", rs2_subfield: "00000" /*src_fmt=W, type S*/}, // rd(fp), rs1(int), rm in funct3
            // fcvt.wu.s và fcvt.s.wu tương tự, khác ở rs2_subfield (bit 0 của rs2)

            // Comparisons: rd(int), rs1(fp), rs2(fp)
            // funct7[6:2] = 10100 (bits [1:0] của funct7 không dùng). funct3 xác định loại so sánh.
            "FEQ.S": { type: "R-FP-CMP", opcode: "1010011", funct3: "010", funct7_prefix: "10100" },
            "FLT.S": { type: "R-FP-CMP", opcode: "1010011", funct3: "001", funct7_prefix: "10100" },
            "FLE.S": { type: "R-FP-CMP", opcode: "1010011", funct3: "000", funct7_prefix: "10100" },

            // Moves:
            // FMV.X.W: rd(int), rs1(fp). funct7='1110000', rs2=0, funct3(rm)=0
            "FMV.X.W": { type: "R-FP-CVT", opcode: "1010011", funct7: "1110000", rs2_subfield: "00000", funct3_fixed: "000"},
            // FMV.W.X: rd(fp), rs1(int). funct7='1111000', rs2=0, funct3(rm)=0
            "FMV.W.X": { type: "R-FP-CVT", opcode: "1010011", funct7: "1111000", rs2_subfield: "00000", funct3_fixed: "000"},
        };

        // Lặp qua bảng định dạng để tìm lệnh khớp
        for (const name in instructionFormats) {
            const format = instructionFormats[name];
            let match = false;
            if (format.opcode === opcodeBin) { // Kiểm tra opcode trước
                // Phân loại dựa trên kiểu lệnh đã định nghĩa
                if (format.type === 'R' || format.type === 'R-FP' || format.type === 'R-FP-CMP') {
                    if (format.funct3 === funct3Bin || format.funct3_fixed === funct3Bin || format.funct3 === 'ANY' || format.funct3_cmp === funct3Bin) {
                        if (format.funct7 === funct7Bin || format.funct7_op === funct7Bin || format.funct7_prefix === funct7Bin.substring(0,5) ) {
                            // Đối với R-FP, rs2 chứa format (01000 cho .S). Cần kiểm tra thêm nếu lệnh yêu cầu.
                            // Ví dụ FADD.S, rs2 bits [26:25] (fmt) là 00. Bit [24:20] là rs2.
                            // Mã hóa chuẩn thường đặt fmt vào các bit rs2[26:25] khi rs2 không phải là thanh ghi nguồn thứ 3.
                            // Với lệnh .S, rs2 field thường là 01000 (fmt=00, còn lại là rs2 index).
                            // Nếu instrInfo.rs2_fmt, kiểm tra thêm rs2 (chứa fmt)
                            if (format.rs2_fmt && format.rs2_fmt !== rs2.toString(2).padStart(5, '0').substring(0,format.rs2_fmt.length)) { // rs2 chứa fmt
                                // continue; // Không khớp fmt
                            }
                            match = true;
                        }
                    }
                } else if (format.type === 'R-FP-CVT') {
                     if (format.funct3_rm === funct3Bin || format.funct3_rm === 'ANY' || format.funct3_fixed === funct3Bin) {
                        if(format.funct7 === funct7Bin || format.funct7_op === funct7Bin) {
                            // Kiểm tra rs2_subfield (thường là chỉ số thanh ghi rs2 hoặc các bit format)
                            if (format.rs2_subfield && format.rs2_subfield !== rs2.toString(2).padStart(5,'0').substring(0, format.rs2_subfield.length)) {
                                // continue;
                            }
                            match = true;
                        }
                     }
                } else if (format.type === 'I' || format.type === 'I-FP' || format.type === 'I-shamt') {
                    if (format.funct3 === funct3Bin) {
                        if (format.immFieldMatcher !== undefined) { // Dành cho ECALL, EBREAK
                            if ((instructionWord >>> 20).toString(2).padStart(12, '0') === format.immFieldMatcher) match = true;
                        } else if (format.funct7Matcher !== undefined) { // Dành cho SLLI, SRLI, SRAI
                            if (funct7Bin === format.funct7Matcher) match = true;
                        } else { // Các lệnh I-type thông thường và I-FP
                            match = true;
                        }
                    }
                } else if (format.type === 'S' || format.type === 'S-FP' || format.type === 'B') {
                    if (format.funct3 === funct3Bin) match = true;
                } else if (format.type === 'U' || format.type === 'J') {
                    match = true; // Chỉ cần opcode cho U và J type
                }
            }
            if (match) {
                opName = name;
                type = format.type;
                // Lấy rm từ funct3 nếu lệnh không phải là so sánh hoặc move có funct3 cố định
                if (type.startsWith('R-FP') && !type.endsWith('CMP') && format.funct3_fixed === undefined) {
                    rm = funct3; // funct3 chứa rounding mode
                } else if (type.startsWith('R-FP-CVT') && format.funct3_fixed === undefined) {
                    rm = funct3; // funct3 chứa rounding mode
                }
                break; // Tìm thấy lệnh, thoát vòng lặp
            }
        }

        // Trích xuất và mở rộng dấu cho giá trị immediate dựa trên loại lệnh
        if (type) {
            switch (type) {
                case "I": // Bao gồm cả ECALL/EBREAK
                case "I-FP": // Bao gồm FLW
                    imm = instructionWord >> 20; // JS '>>' tự động mở rộng dấu từ bit 31 của instructionWord
                    break;
                case "I-shamt": // SLLI, SRLI, SRAI
                    imm = (instructionWord >> 20) & 0x1F; // shamt là 5 bit không dấu
                    break;
                case "S": // Bao gồm SW
                case "S-FP": // Bao gồm FSW
                    // imm[11:5] từ instructionWord[31:25], imm[4:0] từ instructionWord[11:7]
                    imm = (((instructionWord >> 25) & 0x7F) << 5) | ((instructionWord >> 7) & 0x1F);
                    if ((instructionWord >> 31) & 1) imm |= 0xFFFFF000; // Mở rộng dấu từ bit 11 của imm
                    break;
                case "B":
                    // imm[12|10:5] và imm[4:1|11], nhân 2, mở rộng dấu
                    imm = (((instructionWord >> 31) & 0x1) << 12) | // imm[12] (bit 31 của lệnh)
                          (((instructionWord >> 7) & 0x1) << 11) |   // imm[11] (bit 7 của lệnh)
                          (((instructionWord >> 25) & 0x3F) << 5) |  // imm[10:5] (bit 30-25 của lệnh)
                          (((instructionWord >> 8) & 0xF) << 1);     // imm[4:1] (bit 11-8 của lệnh)
                    // Offset được nhân 2 nhưng đã được mã hóa sẵn, chỉ cần mở rộng dấu từ bit 12 của offset
                    if ((instructionWord >> 31) & 1) imm |= 0xFFFFE000; // Mở rộng dấu từ bit 12 của offset (bit 31 của lệnh)
                    break;
                case "U":
                    // imm[31:12] được đặt vào thanh ghi, các bit thấp là 0
                    imm = instructionWord & 0xFFFFF000;
                    break;
                case "J":
                    // imm[20|10:1|11|19:12], nhân 2, mở rộng dấu
                    imm = (((instructionWord >> 31) & 0x1) << 20) |    // imm[20] (bit 31)
                          (((instructionWord >> 12) & 0xFF) << 12) |  // imm[19:12] (bit 30-21 -> 19-12)
                          (((instructionWord >> 20) & 0x1) << 11) |   // imm[11] (bit 20)
                          (((instructionWord >> 21) & 0x3FF) << 1);   // imm[10:1] (bit 30-21 -> 10-1)
                    if ((instructionWord >> 31) & 1) imm |= 0xFFE00000; // Mở rộng dấu từ bit 20 của offset
                    break;
                // R-type, R-FP, R-FP-CVT, R-FP-CMP không có immediate chính từ instructionWord theo cách này
            }
        } else {
            // console.warn(`decode: Could not determine instruction type for word: 0x${instructionWord.toString(16).padStart(8, '0')}`);
        }
        // Trả về đối tượng chứa các thành phần đã giải mã
        return { opName, type, opcode: opcodeBin, rd, rs1, rs2, funct3: funct3Bin, funct7: funct7Bin, imm, rm };
    },

    // EXECUTE: Thực thi lệnh đã được giải mã
    execute(decoded) {
        const { opName, type, rd, rs1, rs2, funct3, funct7, imm, rm } = decoded;
        const val1_int = (rs1 === 0 && type !== 'R-FP-CVT' && type !== 'FMV.W.X') ? 0 : (this.registers[rs1] | 0);
        const val2_int = (rs2 === 0 && type !== 'R-FP-CVT') ? 0 : (this.registers[rs2] | 0);
        const val1_fp = this.fregisters[rs1];
        const val2_fp = this.fregisters[rs2];
        const pc = this.pc;
        let result_int = undefined;
        let result_fp = undefined;
        let memoryAddress = 0;
        let memoryValue = 0;
        let branchTaken = false;
        let nextPc = undefined;
        const INT32_MIN = -2147483648;
        const UINT32_MAX_AS_SIGNED = -1;

        switch (opName) {
            // --- Integer & Mul/Div ---
            case 'ADD': result_int = (val1_int + val2_int) | 0; break;
            case 'SUB': result_int = (val1_int - val2_int) | 0; break;
            case 'SLL': result_int = (val1_int << (val2_int & 0x1F)) | 0; break;
            case 'SLT': result_int = (val1_int < val2_int) ? 1 : 0; break;
            case 'SLTU': result_int = ((val1_int >>> 0) < (val2_int >>> 0)) ? 1 : 0; break;
            case 'XOR': result_int = (val1_int ^ val2_int) | 0; break;
            case 'SRL': result_int = val1_int >>> (val2_int & 0x1F); break;
            case 'SRA': result_int = val1_int >> (val2_int & 0x1F); break;
            case 'OR': result_int = (val1_int | val2_int) | 0; break;
            case 'AND': result_int = (val1_int & val2_int) | 0; break;
            case 'MUL': result_int = Math.imul(val1_int, val2_int); break;
            case 'MULH': result_int = Number((BigInt(val1_int) * BigInt(val2_int)) >> 32n); break;
            case 'MULHSU': result_int = Number((BigInt(val1_int) * BigInt(val2_int >>> 0)) >> 32n); break;
            case 'MULHU': result_int = Number((BigInt(val1_int >>> 0) * BigInt(val2_int >>> 0)) >> 32n); break;
            case 'DIV':
                if (val2_int === 0) result_int = UINT32_MAX_AS_SIGNED;
                else if (val1_int === INT32_MIN && val2_int === -1) result_int = INT32_MIN;
                else result_int = (val1_int / val2_int) | 0;
                break;
            case 'DIVU':
                if (val2_int === 0) result_int = UINT32_MAX_AS_SIGNED;
                else result_int = ((val1_int >>> 0) / (val2_int >>> 0)) | 0;
                break;
            case 'REM':
                if (val2_int === 0) result_int = val1_int;
                else if (val1_int === INT32_MIN && val2_int === -1) result_int = 0;
                else result_int = val1_int % val2_int;
                break;
            case 'REMU':
                if (val2_int === 0) result_int = val1_int >>> 0;
                else result_int = (val1_int >>> 0) % (val2_int >>> 0);
                break;
            case 'ADDI': result_int = (val1_int + imm) | 0; break;
            case 'SLTI': result_int = (val1_int < imm) ? 1 : 0; break;
            case 'SLTIU': result_int = ((val1_int >>> 0) < (imm >>> 0)) ? 1 : 0; break;
            case 'XORI': result_int = (val1_int ^ imm) | 0; break;
            case 'ORI': result_int = (val1_int | imm) | 0; break;
            case 'ANDI': result_int = (val1_int & imm) | 0; break;
            case 'SLLI': result_int = (val1_int << imm) | 0; break;
            case 'SRLI': result_int = val1_int >>> imm; break;
            case 'SRAI': result_int = val1_int >> imm; break;
            case 'LB':
                memoryAddress = (val1_int + imm) | 0;
                memoryValue = this.tilelinkMem.readByte(memoryAddress);
                result_int = (memoryValue & 0x80) ? (memoryValue | 0xFFFFFF00) : (memoryValue & 0xFF);
                break;
            case 'LH':
                memoryAddress = (val1_int + imm) | 0;
                const lh_b0 = this.tilelinkMem.readByte(memoryAddress), lh_b1 = this.tilelinkMem.readByte(memoryAddress + 1);
                memoryValue = (lh_b1 << 8) | lh_b0;
                result_int = (memoryValue & 0x8000) ? (memoryValue | 0xFFFF0000) : (memoryValue & 0xFFFF);
                break;
            case 'LW':
                memoryAddress = (val1_int + imm) | 0;
                result_int = this.tilelinkMem.readWord(memoryAddress);
                break;
            case 'LBU':
                memoryAddress = (val1_int + imm) | 0;
                memoryValue = this.tilelinkMem.readByte(memoryAddress);
                result_int = memoryValue & 0xFF;
                break;
            case 'LHU':
                memoryAddress = (val1_int + imm) | 0;
                const lhu_b0 = this.tilelinkMem.readByte(memoryAddress), lhu_b1 = this.tilelinkMem.readByte(memoryAddress + 1);
                memoryValue = (lhu_b1 << 8) | lhu_b0;
                result_int = memoryValue & 0xFFFF;
                break;
            case 'SB':
                memoryAddress = (val1_int + imm) | 0;
                this.tilelinkMem.writeByte(memoryAddress, val2_int);
                break;
            case 'SH':
                memoryAddress = (val1_int + imm) | 0;
                this.tilelinkMem.writeByte(memoryAddress, val2_int & 0xFF);
                this.tilelinkMem.writeByte(memoryAddress + 1, (val2_int >> 8) & 0xFF);
                break;
            case 'SW':
                memoryAddress = (val1_int + imm) | 0;
                this.tilelinkMem.writeWord(memoryAddress, val2_int);
                break;
            case 'LUI': result_int = imm; break;
            case 'AUIPC': result_int = (pc + imm) | 0; break;
            case 'JAL': result_int = pc + 4; nextPc = (pc + imm) | 0; break;
            case 'JALR': result_int = pc + 4; nextPc = (val1_int + imm) & ~1; break;
            case 'BEQ': if (val1_int === val2_int) branchTaken = true; break;
            case 'BNE': if (val1_int !== val2_int) branchTaken = true; break;
            case 'BLT': if (val1_int < val2_int) branchTaken = true; break;
            case 'BGE': if (val1_int >= val2_int) branchTaken = true; break;
            case 'BLTU': if ((val1_int >>> 0) < (val2_int >>> 0)) branchTaken = true; break;
            case 'BGEU': if ((val1_int >>> 0) >= (val2_int >>> 0)) branchTaken = true; break;
            case 'ECALL': this.handleSyscall(); break;
            case 'EBREAK': this.isRunning = false; throw new Error("EBREAK instruction encountered.");

            // --- RV32F ---
            case 'FLW':
                memoryAddress = (val1_int + imm) | 0;
                const flw_b0 = this.tilelinkMem.readByte(memoryAddress);
                const flw_b1 = this.tilelinkMem.readByte(memoryAddress + 1);
                const flw_b2 = this.tilelinkMem.readByte(memoryAddress + 2);
                const flw_b3 = this.tilelinkMem.readByte(memoryAddress + 3);
                const flw_buffer = new ArrayBuffer(4);
                const flw_view = new DataView(flw_buffer);
                flw_view.setUint8(0, flw_b0); flw_view.setUint8(1, flw_b1);
                flw_view.setUint8(2, flw_b2); flw_view.setUint8(3, flw_b3);
                result_fp = flw_view.getFloat32(0, true);
                break;
            case 'FSW':
                memoryAddress = (val1_int + imm) | 0;
                const fsw_float_val = val2_fp;
                const fsw_buffer = new ArrayBuffer(4);
                const fsw_view = new DataView(fsw_buffer);
                fsw_view.setFloat32(0, fsw_float_val, true);
                for (let i = 0; i < 4; i++) {
                    this.tilelinkMem.writeByte(memoryAddress + i, fsw_view.getUint8(i));
                }
                break;
            case 'FADD.S': result_fp = val1_fp + val2_fp; break;
            case 'FSUB.S': result_fp = val1_fp - val2_fp; break;
            case 'FMUL.S': result_fp = val1_fp * val2_fp; break;
            case 'FDIV.S':
                if (val2_fp === 0.0) {
                    result_fp = (val1_fp > 0.0 ? Infinity : (val1_fp < 0.0 ? -Infinity : NaN));
                } else {
                    result_fp = val1_fp / val2_fp;
                }
                break;
            case 'FCVT.W.S':
                let rounded_w;
                switch (rm) {
                    case 0b000: rounded_w = Math.round(val1_fp); break;
                    case 0b001: rounded_w = Math.trunc(val1_fp); break;
                    default: rounded_w = Math.round(val1_fp);
                }
                if (isNaN(val1_fp) || val1_fp > 2147483647.0) rounded_w = 2147483647;
                else if (val1_fp < -2147483648.0) rounded_w = -2147483648;
                result_int = rounded_w | 0;
                break;
            case 'FCVT.S.W':
                result_fp = Number(val1_int);
                break;
            case 'FEQ.S':
                if (isNaN(val1_fp) || isNaN(val2_fp)) result_int = 0;
                else result_int = (val1_fp === val2_fp) ? 1 : 0;
                break;
            case 'FLT.S':
                if (isNaN(val1_fp) || isNaN(val2_fp)) result_int = 0;
                else result_int = (val1_fp < val2_fp) ? 1 : 0;
                break;
            case 'FLE.S':
                if (isNaN(val1_fp) || isNaN(val2_fp)) result_int = 0;
                else result_int = (val1_fp <= val2_fp) ? 1 : 0;
                break;
            case 'FMV.X.W':
                const fmvxw_buffer = new ArrayBuffer(4);
                const fmvxw_view = new DataView(fmvxw_buffer);
                fmvxw_view.setFloat32(0, val1_fp, true);
                result_int = fmvxw_view.getInt32(0, true);
                break;
            case 'FMV.W.X':
                const fmvwx_buffer = new ArrayBuffer(4);
                const fmvwx_view = new DataView(fmvwx_buffer);
                fmvwx_view.setInt32(0, val1_int, true);
                result_fp = fmvwx_view.getFloat32(0, true);
                break;
            default:
                throw new Error(`Execute: Instruction ${opName} (Type: ${type}) is not implemented in the simulator.`);
        }

        if (rd !== 0) {
            if (result_int !== undefined) {
                this.registers[rd] = result_int | 0;
            }
            if (result_fp !== undefined) {
                this.fregisters[rd] = result_fp;
            }
        } else if (rd === 0 && (result_int !== undefined && result_int !== 0)) {
            // Ignore write to x0
        } else if (rd === 0 && (result_fp !== undefined && result_fp !== 0.0)) {
            this.fregisters[rd] = result_fp;
        }

        if (type === 'B' && branchTaken) {
            nextPc = (pc + imm) | 0;
        }
        return { nextPc };
    },

    // --- System Call: dùng tilelinkMem ---
    handleSyscall() {
        const syscallId = this.registers[17];
        const arg0 = this.registers[10];
        const arg1 = this.registers[11];
        const arg2 = this.registers[12];

        switch (syscallId) {
            case 93:
                this.isRunning = false;
                alert(`Program exited with code: ${arg0}`);
                if (this.registers[10] !== undefined) this.registers[10] = arg0;
                break;
            case 1:
                alert(`Print Int: ${arg0}`);
                break;
            case 4:
                let str = "";
                let addr = arg0;
                let charByte;
                while (true) {
                    try {
                        charByte = this.tilelinkMem.readByte(addr);
                    } catch {
                        break;
                    }
                    if (charByte === 0) break;
                    str += String.fromCharCode(charByte);
                    addr++;
                    if (str.length > 1000) {
                        str += "... (truncated)";
                        break;
                    }
                }
                alert(`Print String:\n${str}`);
                break;
            case 64:
                const fd_write = arg0;
                const bufAddr_write = arg1;
                const count_write = arg2;
                if (fd_write === 1) {
                    let outputStr = "";
                    for (let i = 0; i < count_write; i++) {
                        let byte;
                        try {
                            byte = this.tilelinkMem.readByte(bufAddr_write + i);
                        } catch {
                            this.registers[10] = i;
                            return;
                        }
                        outputStr += String.fromCharCode(byte);
                    }
                    alert(`Write to stdout:\n${outputStr}`);
                    this.registers[10] = outputStr.length;
                } else {
                    this.registers[10] = -1;
                }
                break;
            default:
                console.warn(`Unsupported syscall ID: ${syscallId}`);
        }
    }
};