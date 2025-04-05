import { assembler } from './assembler.js';

export const simulator = {
    registers: new Int32Array(32),  // Sử dụng Int32Array để đảm bảo xử lý số nguyên 32-bit
    memory: {},                     // Bộ nhớ (byte addressable - địa chỉ byte -> giá trị byte)
    pc: 0,                          // Program Counter (địa chỉ lệnh hiện tại)
    isRunning: false,               // Cờ kiểm soát vòng lặp chạy tự động
    instructionCount: 0,            // Đếm số lệnh đã thực thi
    maxSteps: 1000000,              // Giới hạn số bước chạy để tránh vòng lặp vô hạn

    // --- Các hàm quản lý trạng thái ---

    /**
     * Đặt lại trạng thái thanh ghi về 0 và PC về địa chỉ bắt đầu mặc định.
     */
    resetRegisters() {
        this.registers.fill(0);
        this.pc = 0; // Hoặc địa chỉ bắt đầu mặc định, sẽ được ghi đè bởi loadProgram
        console.log("Registers reset.");
    },

    /**
     * Xóa bộ nhớ mô phỏng.
     */
    resetMemory() {
        this.memory = {};
        console.log("Memory reset.");
    },

    /**
     * Đặt lại toàn bộ trạng thái của trình mô phỏng.
     */
    reset() {
        this.resetRegisters();
        this.resetMemory();
        this.isRunning = false;
        this.instructionCount = 0;
        console.log("Simulator state reset.");
    },

    /**
     * Nạp dữ liệu từ bộ nhớ đã được biên dịch vào bộ nhớ của trình mô phỏng.
     * @param {object} memoryData - Đối tượng bộ nhớ từ assembler.
     * @param {number} startAddress - Địa chỉ bắt đầu thực thi (PC ban đầu).
     */
    loadProgram(memoryData, startAddress = 0x00000000) { // Đổi mặc định về 0 nếu .text không có địa chỉ
        this.reset(); // Reset trước khi load chương trình mới
        // Sao chép sâu bộ nhớ để tránh tham chiếu
        for (const addr in memoryData) {
            // Đảm bảo địa chỉ là số nguyên
            this.memory[parseInt(addr)] = memoryData[addr];
        }
        this.pc = startAddress; // Đặt PC vào địa chỉ bắt đầu
        console.log(`Memory loaded into simulator. PC set to 0x${startAddress.toString(16).padStart(8, '0')}`);
    },

    // --- Các hàm thực thi ---

    /**
     * Thực thi chương trình liên tục cho đến khi dừng hoặc gặp lỗi.
     */
    run() {
        this.isRunning = true;
        this.instructionCount = 0; // Reset bộ đếm lệnh
        console.log(`Starting simulation run from PC: 0x${this.pc.toString(16).padStart(8, '0')}`);

        while (this.isRunning) {
            if (this.instructionCount >= this.maxSteps) {
                this.isRunning = false;
                console.warn(`Simulation stopped: Maximum instruction steps (${this.maxSteps}) reached.`);
                throw new Error(`Maximum instruction steps reached.`); // Ném lỗi để hiển thị
            }

            try {
                const currentPc = this.pc; // Lưu PC trước khi step
                this.step(); // Thực thi một lệnh

                // TODO: Thêm logic kiểm tra điều kiện dừng chính thức (ví dụ: lệnh ECALL exit)
                // if (isExitSyscallCondition) {
                //     console.log("Exit syscall detected. Halting simulation.");
                //     this.isRunning = false;
                //     break;
                // }

                // Kiểm tra PC không đổi -> vòng lặp vô hạn? (ví dụ: j loop; loop: ...)
                if (this.pc === currentPc) {
                    // Có thể lệnh là nhảy đến chính nó hoặc có lỗi trong cập nhật PC
                    console.warn(`PC did not change after instruction at 0x${currentPc.toString(16)}. Potential infinite loop or error.`);
                    // Tùy chọn: Dừng thực thi hoặc chỉ cảnh báo
                    // this.isRunning = false;
                    // throw new Error(`Potential infinite loop detected at PC 0x${currentPc.toString(16)}`);
                }


            } catch (error) {
                this.isRunning = false; // Dừng khi có lỗi
                console.error("Error during simulation run:", error);
                throw error; // Re-throw lỗi để script.js bắt được
            }
        }

        // Cập nhật UI lần cuối sau khi vòng lặp dừng
        if (typeof window !== 'undefined' && window.updateUIGlobally) {
            window.updateUIGlobally();
        }

        console.log(`Simulation run finished/stopped after ${this.instructionCount} instructions. Final PC: 0x${this.pc.toString(16).padStart(8, '0')}`);
    },

    /**
     * Dừng quá trình thực thi đang chạy.
     */
    stop() {
        this.isRunning = false;
        console.log("Simulation run stopped by user.");
    },

    /**
     * Thực thi một lệnh duy nhất.
     */
    step() {
        if (this.pc === null || this.pc === undefined) {
            throw new Error("Cannot execute step: Program Counter (PC) is not set. Assemble code first.");
        }
        const currentPcForStep = this.pc; // Lưu PC cho lần step này
        console.log(`Executing step at PC: 0x${currentPcForStep.toString(16).padStart(8, '0')}`);

        const instructionWord = this.fetch(currentPcForStep); // Lấy lệnh 32-bit
        console.log(` Fetched instruction word (decimal): ${instructionWord} (0x${instructionWord.toString(16).padStart(8, '0')})`);

        if (instructionWord === undefined) {
            throw new Error(`No instruction found at address 0x${currentPcForStep.toString(16).padStart(8, '0')}. Memory might be empty or PC out of bounds.`);
        }

        const decoded = this.decode(instructionWord);
        console.log("  Decoded instruction:", decoded);
        if (decoded.opName === 'UNKNOWN') {
            throw new Error(`Could not decode instruction word: 0x${instructionWord.toString(16).padStart(8, '0')} at PC 0x${currentPcForStep.toString(16).padStart(8, '0')}`);
        }


        const executionResult = this.execute(decoded); // Thực thi và lấy kết quả

        // Cập nhật PC
        // Nếu lệnh là nhảy/rẽ nhánh và thành công, execute trả về địa chỉ đích
        if (executionResult && executionResult.nextPc !== undefined) {
            this.pc = executionResult.nextPc;
            console.log(`  Jump/Branch taken. New PC: 0x${this.pc.toString(16).padStart(8, '0')}`);
        } else {
            // Nếu không, tăng PC lên 4 cho lệnh tiếp theo
            this.pc = currentPcForStep + 4; // Luôn tính toán dựa trên PC *trước* khi thực thi lệnh này
            console.log(`  Incrementing PC to: 0x${this.pc.toString(16).padStart(8, '0')}`);
        }

        // Luôn đảm bảo thanh ghi x0 = 0
        this.registers[0] = 0;
        this.instructionCount++; // Tăng bộ đếm lệnh

        // Gọi cập nhật UI (nếu hàm tồn tại trong global scope)
        if (typeof window !== 'undefined' && window.updateUIGlobally) {
            window.updateUIGlobally();
        }
    },

    // --- Các hàm lõi của bộ xử lý ---

    /**
     * Lấy một lệnh 32-bit từ bộ nhớ tại địa chỉ cho trước (little-endian).
     * @param {number} address - Địa chỉ bắt đầu của lệnh.
     * @returns {number|undefined} - Số nguyên 32-bit biểu diễn lệnh, hoặc undefined nếu địa chỉ không hợp lệ.
     */
    fetch(address) {
        // Lấy 4 byte từ bộ nhớ, xử lý trường hợp địa chỉ không có trong bộ nhớ
        // Dùng parseInt để đảm bảo địa chỉ là số
        const addrInt = parseInt(address);
        if (isNaN(addrInt)) return undefined;

        const byte1 = this.memory[addrInt] ?? undefined; // Dùng ?? để xử lý undefined/null
        const byte2 = this.memory[addrInt + 1] ?? undefined;
        const byte3 = this.memory[addrInt + 2] ?? undefined;
        const byte4 = this.memory[addrInt + 3] ?? undefined;

        // Nếu bất kỳ byte nào không tồn tại, lệnh không hợp lệ
        if ([byte1, byte2, byte3, byte4].includes(undefined)) {
            console.error(`Fetch Error: Failed to fetch 4 bytes at address 0x${addrInt.toString(16)}`);
            return undefined;
        }

        // Kết hợp 4 byte thành số nguyên 32-bit (sử dụng bitwise để đảm bảo kết quả 32-bit)
        const instruction = (byte4 << 24) | (byte3 << 16) | (byte2 << 8) | byte1;
        return instruction;
    },

    /**
     * Giải mã một lệnh 32-bit thành các thành phần của nó.
     * @param {number} instructionWord - Lệnh 32-bit.
     * @returns {object} - Đối tượng chứa thông tin đã giải mã (opName, type, rd, rs1, rs2, funct3, funct7, imm).
     */
    decode(instructionWord) {
        // --- Trích xuất các trường cơ bản ---
        const opcode = instructionWord & 0b1111111; // 7 bits [6:0]
        const rd = (instructionWord >>> 7) & 0b11111;   // 5 bits [11:7]
        const funct3 = (instructionWord >>> 12) & 0b111;    // 3 bits [14:12]
        const rs1 = (instructionWord >>> 15) & 0b11111;  // 5 bits [19:15]
        const rs2 = (instructionWord >>> 20) & 0b11111;  // 5 bits [24:20]
        const funct7 = (instructionWord >>> 25) & 0b1111111;// 7 bits [31:25]

        const opcodeBin = opcode.toString(2).padStart(7, '0');
        const funct3Bin = funct3.toString(2).padStart(3, '0');
        const funct7Bin = funct7.toString(2).padStart(7, '0');


        let imm = 0;
        let type = null;
        let opName = "UNKNOWN";

        // --- Xác định loại lệnh và tên lệnh ---
        for (const key in assembler.instructionFormats) {
            // Kiểm tra xem key có phải là thuộc tính trực tiếp của đối tượng không
            if (Object.hasOwnProperty.call(assembler.instructionFormats, key)) {
                const format = assembler.instructionFormats[key];
                let match = false;
                // So sánh opcode trước
                if (format.opcode === opcodeBin) {
                    // Nếu là R-type, cần kiểm tra thêm funct3 và funct7
                    if (format.type === 'R') {
                        if (format.funct3 === funct3Bin && format.funct7 === funct7Bin) {
                            match = true;
                        }
                    }
                    // Nếu là U hoặc J type, chỉ cần opcode
                    else if (format.type === 'U' || format.type === 'J') {
                        match = true;
                    }
                    // Nếu là I, S, B type, cần kiểm tra thêm funct3
                    else if (format.funct3 === funct3Bin) {
                        match = true;
                    }
                    // Xử lý trường hợp đặc biệt của SLLI, SRLI, SRAI (I-type nhưng có funct7)
                    else if (format.type === 'I' && format.funct7 !== undefined && format.funct7 === funct7Bin && format.funct3 === funct3Bin) {
                        match = true;
                    }
                }
                // Nếu khớp, lấy thông tin và thoát vòng lặp
                if (match) {
                    type = format.type;
                    opName = key; // Lấy tên lệnh
                    break;
                }
            }
        }


        // --- Tính giá trị Immediate dựa trên loại lệnh ---
        // Chỉ tính imm nếu type được xác định
        if (type) {
            switch (type) {
                case "I":
                    imm = instructionWord >> 20; // Sign extension tự động với >> trong JS cho số 32-bit
                    break;
                case "S":
                    imm = ((instructionWord >> 7) & 0x1F) | ((instructionWord >> 25) << 5); // Lấy bit và dịch trái
                    if ((instructionWord >> 31) & 1) imm |= 0xFFFFF000; // Sign-extend
                    break;
                case "B":
                    imm = (((instructionWord >> 8) & 0xF) << 1) |     // imm[4:1]
                        (((instructionWord >> 25) & 0x3F) << 5) |   // imm[10:5]
                        (((instructionWord >> 7) & 0x1) << 11) |    // imm[11]
                        (instructionWord & 0x80000000 ? 0xFFFFF000 : 0); // Sign bit imm[12] -> sign extend
                    // Correct sign extension for B-type immediate from bit 12
                    if ((instructionWord >> 31) & 1) {
                        imm = imm | 0xFFFFE000; // Extend from bit 12
                    } else {
                        // imm = imm & 0x00001FFF; // Ensure positive is correct (optional)
                    }
                    // Lấy bit dấu cuối cùng (bit 31 của instruction) để mở rộng dấu cho imm 13 bit
                    if ((instructionWord >> 31) & 1) imm |= 0xFFFFE000;


                    break;
                case "U":
                    imm = instructionWord & 0xFFFFF000; // imm[31:12]
                    break;
                case "J":
                    imm = (((instructionWord >> 21) & 0x3FF) << 1) |  // imm[10:1]
                        (((instructionWord >> 20) & 0x1) << 11) |   // imm[11]
                        (((instructionWord >> 12) & 0xFF) << 12) |  // imm[19:12]
                        (instructionWord & 0x80000000 ? 0xFFF00000 : 0); // Sign bit imm[20] -> sign extend
                    // Correct sign extension for J-type immediate from bit 20
                    if ((instructionWord >> 31) & 1) {
                        imm = imm | 0xFFE00000; // Extend from bit 20
                    } else {
                        // imm = imm & 0x001FFFFF; // Ensure positive is correct (optional)
                    }
                    // Lấy bit dấu cuối cùng (bit 31 của instruction) để mở rộng dấu cho imm 21 bit
                    if ((instructionWord >> 31) & 1) imm |= 0xFFE00000;

                    break;
                // R-type không có imm ở trường chính
            }
        } else {
            console.warn(`Could not determine instruction type for word: 0x${instructionWord.toString(16).padStart(8, '0')}`);
        }

        // --- Log kết quả decode ---
        console.log("--- Decoded ---");
        console.log("  Word:", `0x${instructionWord.toString(16).padStart(8, '0')}`);
        console.log(`  opName: ${opName}, type: ${type}`);
        console.log(`  rd: ${rd} (x${rd})`);
        console.log(`  rs1: ${rs1} (x${rs1})`);
        console.log(`  rs2: ${rs2} (x${rs2})`);
        console.log(`  funct3: ${funct3Bin}`);
        console.log(`  funct7: ${funct7Bin}`);
        console.log(`  imm: ${imm} (0x${(imm).toString(16)})`); // Hiển thị imm đã qua sign extend nếu có
        console.log("---------------");


        return { opName, type, opcode: opcodeBin, rd, rs1, rs2, funct3: funct3Bin, funct7: funct7Bin, imm };
    },

    /**
     * Thực thi lệnh đã được giải mã.
     * @param {object} decoded - Đối tượng chứa thông tin lệnh đã giải mã.
     * @returns {object|null} - Trả về { nextPc: địa_chỉ } nếu là lệnh nhảy/rẽ nhánh thành công, ngược lại trả về null hoặc {}.
     */
    execute(decoded) {
        const { opName, type, rd, rs1, rs2, funct3, funct7, imm } = decoded;

        // Đọc giá trị thanh ghi nguồn, đảm bảo x0 luôn là 0
        const val1 = (rs1 === 0) ? 0 : (this.registers[rs1] | 0);
        const val2 = (rs2 === 0) ? 0 : (this.registers[rs2] | 0);

        let result = undefined; // Kết quả tính toán sẽ ghi vào rd
        let memoryAddress = 0;  // Địa chỉ bộ nhớ cho lệnh load/store
        let memoryValue = 0;    // Giá trị đọc/ghi từ/vào bộ nhớ
        let branchTaken = false;// Cờ cho biết rẽ nhánh có xảy ra không
        let nextPc = undefined; // Địa chỉ PC tiếp theo nếu có nhảy/rẽ nhánh

        console.log(`  Executing: ${opName} rd=x${rd}, rs1=x${rs1}(${val1}), rs2=x${rs2}(${val2}), imm=${imm}`);

        // --- Logic thực thi dựa trên tên lệnh ---
        switch (opName) {
            // --- R-Type ---
            case 'ADD': result = val1 + val2; break;
            case 'SUB': result = val1 - val2; break;
            case 'SLL': result = val1 << (val2 & 0x1F); break;
            case 'SLT': result = (val1 < val2) ? 1 : 0; break;
            case 'SLTU': result = ((val1 >>> 0) < (val2 >>> 0)) ? 1 : 0; break;
            case 'XOR': result = val1 ^ val2; break;
            case 'SRL': result = val1 >>> (val2 & 0x1F); break;
            case 'SRA': result = val1 >> (val2 & 0x1F); break;
            case 'OR': result = val1 | val2; break;
            case 'AND': result = val1 & val2; break;

            // --- I-Type ---
            case 'ADDI': result = val1 + imm; break;
            case 'SLTI': result = (val1 < imm) ? 1 : 0; break;
            case 'SLTIU': result = ((val1 >>> 0) < (imm >>> 0)) ? 1 : 0; break; // So sánh không dấu với imm
            case 'XORI': result = val1 ^ imm; break;
            case 'ORI': result = val1 | imm; break;
            case 'ANDI': result = val1 & imm; break;

            // Shifts Immediate (I-type với funct7 đặc biệt)
            case 'SLLI': result = val1 << (imm & 0x1F); break; // shamt là 5 bit thấp của imm field
            case 'SRLI': result = val1 >>> (imm & 0x1F); break;
            case 'SRAI': result = val1 >> (imm & 0x1F); break;


            // Load Instructions
            case 'LB':
                memoryAddress = val1 + imm;
                memoryValue = this.memory[memoryAddress] ?? 0;
                result = (memoryValue & 0x80) ? (memoryValue | 0xFFFFFF00) : memoryValue; // Sign extend byte
                console.log(`   Load Byte from 0x${memoryAddress.toString(16)}: raw=${memoryValue}, sign-extended=${result}`);
                break;
            case 'LH':
                memoryAddress = val1 + imm;
                memoryValue = ((this.memory[memoryAddress + 1] ?? 0) << 8) | (this.memory[memoryAddress] ?? 0);
                result = (memoryValue & 0x8000) ? (memoryValue | 0xFFFF0000) : memoryValue; // Sign extend halfword
                console.log(`   Load Half from 0x${memoryAddress.toString(16)}: raw=${memoryValue}, sign-extended=${result}`);
                break;
            case 'LW':
                memoryAddress = val1 + imm;
                memoryValue = ((this.memory[memoryAddress + 3] ?? 0) << 24) |
                    ((this.memory[memoryAddress + 2] ?? 0) << 16) |
                    ((this.memory[memoryAddress + 1] ?? 0) << 8) |
                    (this.memory[memoryAddress] ?? 0);
                result = memoryValue | 0; // Đảm bảo là 32-bit integer
                console.log(`   Load Word from 0x${memoryAddress.toString(16)}: value=${result}`);
                break;
            case 'LBU':
                memoryAddress = val1 + imm;
                result = this.memory[memoryAddress] ?? 0; // Zero extended tự động
                console.log(`   Load Byte Unsigned from 0x${memoryAddress.toString(16)}: value=${result}`);
                break;
            case 'LHU':
                memoryAddress = val1 + imm;
                result = ((this.memory[memoryAddress + 1] ?? 0) << 8) | (this.memory[address] ?? 0); // Zero extended tự động
                console.log(`   Load Half Unsigned from 0x${memoryAddress.toString(16)}: value=${result}`);
                break;

            // Jump and Link Register
            case 'JALR':
                nextPc = (val1 + imm) & ~1; // Tính địa chỉ nhảy, đảm bảo 2 byte aligned (bit cuối là 0)
                result = this.pc + 4;       // Địa chỉ trả về (lệnh tiếp sau JALR) lưu vào rd
                console.log(`   JALR: Branch target=0x${nextPc.toString(16)}, Return address=0x${result.toString(16)}`);
                break;

            // --- S-Type ---
            case 'SB':
                memoryAddress = val1 + imm;
                memoryValue = val2 & 0xFF; // Lấy byte thấp nhất của rs2
                this.memory[memoryAddress] = memoryValue;
                result = undefined; // Store không ghi vào rd
                console.log(`   Store Byte: value=${memoryValue} to 0x${memoryAddress.toString(16)}`);
                break;
            case 'SH':
                memoryAddress = val1 + imm;
                this.memory[memoryAddress] = val2 & 0xFF;         // Byte thấp
                this.memory[memoryAddress + 1] = (val2 >> 8) & 0xFF;  // Byte cao
                result = undefined;
                console.log(`   Store Half: value=${val2 & 0xFFFF} to 0x${memoryAddress.toString(16)}`);
                break;
            case 'SW':
                memoryAddress = val1 + imm;
                this.memory[memoryAddress] = val2 & 0xFF;
                this.memory[memoryAddress + 1] = (val2 >> 8) & 0xFF;
                this.memory[memoryAddress + 2] = (val2 >> 16) & 0xFF;
                this.memory[memoryAddress + 3] = (val2 >> 24) & 0xFF;
                result = undefined;
                console.log(`   Store Word: value=${val2} to 0x${memoryAddress.toString(16)}`);
                break;

            // --- U-Type ---
            case 'LUI':
                result = imm; // imm đã là 20 bit cao, 12 bit thấp = 0
                console.log(`   LUI: result=${result}`);
                break;
            case 'AUIPC':
                result = this.pc + imm; // Add imm (đã dịch trái 12 bit trong decode) vào PC hiện tại
                console.log(`   AUIPC: pc=0x${this.pc.toString(16)}, imm=0x${imm.toString(16)}, result=0x${result.toString(16)}`);
                break;

            // --- B-Type ---
            case 'BEQ': branchTaken = (val1 === val2); break;
            case 'BNE': branchTaken = (val1 !== val2); break;
            case 'BLT': branchTaken = (val1 < val2); break; // Signed
            case 'BGE': branchTaken = (val1 >= val2); break; // Signed
            case 'BLTU': branchTaken = ((val1 >>> 0) < (val2 >>> 0)); break; // Unsigned
            case 'BGEU': branchTaken = ((val1 >>> 0) >= (val2 >>> 0)); break; // Unsigned

            // --- J-Type ---
            case 'JAL':
                nextPc = this.pc + imm; // Tính địa chỉ nhảy tuyệt đối
                result = this.pc + 4;    // Lưu địa chỉ trả về vào rd
                console.log(`   JAL: Branch target=0x${nextPc.toString(16)}, Return address=0x${result.toString(16)}`);
                break;

            // --- System ---
            case 'ECALL':
                console.log("ECALL instruction encountered.");
                // TODO: Xử lý syscalls (ví dụ: exit, print)
                // Tạm thời dừng simulation
                throw new Error("ECALL not implemented - Halting simulation.");
                // this.isRunning = false; // Hoặc dừng vòng lặp run
                break;

            default:
                console.warn(`Execute: Instruction ${opName} (Type: ${type}) not yet implemented.`);
                throw new Error(`Execute: Instruction ${opName} not implemented.`);
        }

        // --- Write Back ---
        if (rd !== undefined && rd !== 0 && result !== undefined) {
            this.registers[rd] = result | 0; // Ghi kết quả, đảm bảo 32-bit
            console.log(`   Write reg x${rd}: ${this.registers[rd]} (0x${this.registers[rd].toString(16).padStart(8, '0')})`);
        } else if (rd === 0 && result !== undefined) {
            console.log(`   Attempted to write to x0 (ignored). Result was: ${result}`);
        }

        // Xử lý PC cho lệnh Branch sau khi đã tính toán branchTaken
        if (type === 'B') {
            console.log(`   Branch Condition (${opName}): ${branchTaken}`);
            if (branchTaken) {
                nextPc = this.pc + imm; // Tính địa chỉ rẽ nhánh
            }
            result = undefined; // Lệnh B không ghi vào rd
        }

        console.log("--- End Execute ---");
        return { nextPc }; // Trả về địa chỉ PC tiếp theo (nếu có thay đổi)
    },
};
