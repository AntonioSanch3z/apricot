
from __future__ import print_function
from IPython.core.magic import (Magics, magics_class, line_magic,
                                cell_magic, line_cell_magic)
import os, glob
import subprocess
import json
from tabulate import tabulate

@magics_class
class Apricot(Magics):

    actualDir = ""
    oneDataToken = ""
    oneDataHost = ""
    oneDataStore = "/opt/onedata_spaces/"

    ########################
    #  Auxiliar functions  #
    ########################
    
    def splitClear(self, line, pattern=' '):

        if len(line) == 0:
            return []

        return list(filter(len,line.split(pattern)))

    def multiparametricRun(self, execPath, clustername, queue, script, ranges, rangeID):

        if queue != "slurm":
            return "fail: only slurm queue system is allowed"
        
        index = int(rangeID)*3
        low = float(ranges[index])
        top = float(ranges[index+1])
        step = float(ranges[index+2])

        value = low
        identifier = "__" + str(rangeID) + "__"
        while(value <= top):
            localScript = script.replace(identifier,str(value))
            if(rangeID == 0):
                #print(localScript)
                command = "exec " + clustername + " cd " + execPath + " && sbatch << " + localScript
                if self.apricot(command) != "done":
                    return "fail"
                
            else:
                self.multiparametricRun(execPath, clustername, queue, localScript, ranges, rangeID-1)
            value += step
        return "done"

    ##################
    #     Magics     #
    ##################
    
    @line_magic
    def apricot_genMPid(self,line):
        
        if len(line) == 0:
            print("usage: genMPid range1 range2...\n")
            print("range format is as follows: lowest highest step")
            return "fail"
        #Split line
        words = self.splitClear(line)
        rangesData = [float(i) for i in words]

        #Check if last range is incomplete
        if len(rangesData) % 3 != 0:
            print("Last specified range is incomplete. Check ranges.")
            return "fail"        

        nRanges = int(len(rangesData)/3)

        if nRanges <= 0:
            print("Any range specified\n")
            print("range format is as follows: lowest highest step")
            return "fail"

        #Check ranges and create a identificator
        errText = ""
        runID = ""
        errors = False
        for i in list(range(0,nRanges)):
            index = i*3
            if rangesData[index] > rangesData[index+1]:
                errors = True
                errText += "fail in range " + str(i) + ". Upbownd value (" + str(rangesData[index+1]) + ") is smaller than lower limit (" + str(rangesData[index]) + ").\n"
            if rangesData[index+2] <= 0.0:
                errors = True
                errText += "fail in range " + str(i) + ". Step size value (" + str(rangesData[index+2]) + ") must be positive.\n"

            #Append range to identifier
            if i > 0:
                runID += "_"
            runID += str(rangesData[index]) + "to" + str(rangesData[index+1]) + "by" + str(rangesData[index+2])
                
        if errors is True:
            print(errText)
        
        return runID

    @line_magic
    def apricot_log(self, line):
        if len(line) == 0:
            print("usage: apricot_log clustername\n")
            return "fail"

        #Split line
        words = self.splitClear(line)

        #Get cluster name
        clusterName = words[0]

        #Get log
        pipes = subprocess.Popen(["ec3","show","-r",clusterName], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        
        log, std_err = pipes.communicate()
        log = log.decode('utf-8')
        std_err = std_err.decode('utf-8')

        print(log)

        return "done"
        

    @line_magic
    def apricot_onedata(self,line):
        if len(line) == 0:
            print("usage: apricot_onedata clustername instruction parameters...\n")
            print("Valid instructions are: mount, umount, download, upload, set-token, get-token, set-host, get-host")
            return "fail"

        #Split line
        words = self.splitClear(line)
        if len(words) < 2:
            print("usage: apricot_onedata clustername instruction parameters...\n")
            print("Valid instructions are: mount, umount, download, upload, set-token, get-token, set-host, get-host")
            return "fail"

        #Get cluster name
        clusterName = words[0]

        #Get instruction
        instruction = words[1]

        if instruction == "set-token":
            if len(words) < 3:
                print("No token specified")
                return "fail"
            oneDataToken = words[3]
        elif instruction == "get-token":
            return oneDataToken
        elif instruction == "set-host":
            if len(words) < 3:
                print("No host specified")
                return "fail"
            oneDataHost = words[3]
        elif instruction == "get-host":
            return oneDataHost
        elif instruction == "mount":

            if len(words) < 3:
                print("No mount point specified")
                return "fail"

            #Create directory to mount specified space
            if words[2][0] == '/':
                mountPoint = words[2]                
            else:
                mountPoint = self.oneDataStore + words[2]

            self.apricot("exec " + clusterName + " rm -r " + mountPoint + "&> /dev/null")
            status = self.apricot("exec " + clusterName + " mkdir " + mountPoint)
            if status != "done":
                print("Unable to create directory: " + mountPoint)
                return "fail"
                
            
            if len(words) < 4:
                return self.apricot("exec " + clusterName + " oneclient -H " + oneDataHost + " -t " + oneDataToken + " " + mountPoint)
            if len(words) < 5:
                return self.apricot("exec " + clusterName + " oneclient -H " + words[3] + " -t " + oneDataToken + " " + mountPoint)
            else:
                return self.apricot("exec " + clusterName + " oneclient -H " + words[3] + " -t " + words[4] + " " + mountPoint)

        elif instruction == "umount":
            if len(words) < 3:
                print("No mount point specified")
                return "fail"
            return self.apricot("exec " + clusterName + " oneclient -u " + words[2])

        elif instruction == "download" or instruction == "upload":
            if len(words) < 4:
                print("usage: apricot_onedata clusterName cp onedataPath localPath")
                return "fail"

            
            if instruction == "download":
                origin = self.oneDataStore + words[2]
                destin = words[3]
            else:
                origin = words[2]
                destin = self.oneDataStore + words[3]
                
            #Try to copy file from/to already mounted space
            status = self.apricot("exec " + clusterName + " cp " + origin + " " + destin)

            if status != "done":
                return "fail"                
            else:
                return "done"
        
        else:
            print("Unknown instruction")
            return "fail"
            
            
    @line_magic
    def apricot_MPI(self,line):

        if len(line) == 0:
            print("usage: apricot_MPI clustername node_number tasks_number remote/path/to/execute romete/path/to/executable arguments")
            return "fail"

        #Split line
        words = self.splitClear(line)
        
        if len(words) < 5:
            print("usage: apricot_MPI clustername node_number tasks_number remote/path/to/execute romete/path/to/executable arguments")
            return "fail"
        

        #Get cluster name
        clusterName = words[0]

        #Get number of nodes to use
        nodes2use = int(words[1])
        if nodes2use <= 0:
            print("Invalid node number")
            return "fail"

        #Get number of tasks to execute
        ntasks = int(words[2])
        if ntasks <= 0:
            print("Invalid task number")
            return "fail"
        
        #Get execution path
        execPath = words[3]        
        
        #Get program path
        executablePath = words[4]
        
        #Get arguments
        arguments = ""
        if len(line) > 5:
            for word in words[5:]:
                arguments += word
        
        command = "exec " + clusterName + " cd " + execPath + " && salloc -N " + str(nodes2use) + " mpirun -n " + str(ntasks) + " --mca btl_base_warn_component_unused 0 " + executablePath + " " + arguments
        if self.apricot(command) != "done":
            return "fail"        
        return "done"

    @line_magic
    def apricot_runMP(self,line):

        if len(line) == 0:
            print("usage: runMP clustername script execution-path range1 range2...\n")
            print("range format is as follows: lowest highest step")
            return "fail"

        #Split line
        words = self.splitClear(line)

        if len(words) < 4:
            print("usage: runMP clustername script execution-path range1 range2...\n")
            print("range format is as follows: lowest highest step")
            return "fail"

        #Get cluster name
        clusterName = words[0]

        #Get script name
        filename = words[1]

        #Get execution path
        execPath = words[2]        
        
        #Extract ranges data
        rangesDataString = words[3:]
        rangesData = [float(i) for i in rangesDataString]
        
        #Check if last range is incomplete
        if len(rangesData) % 3 != 0:
            print("Last specified range is incomplete. Check ranges.")
            return "fail"
        
        nRanges = int(len(rangesData)/3)

        if nRanges <= 0:
            print("Any range specified\n")
            print("range format is as follows: lowest highest step")
            return "fail"
        
        #Check ranges and create a identificator
        errText = ""
        runID = ""
        errors = False
        for i in list(range(0,nRanges)):
            index = i*3
            if rangesData[index] > rangesData[index+1]:
                errors = True
                errText += "fail in range " + str(i) + ". Upbownd value (" + str(rangesData[index+1]) + ") is smaller than lower limit (" + str(rangesData[index]) + ").\n"
            if rangesData[index+2] <= 0.0:
                errors = True
                errText += "fail in range " + str(i) + ". Step size value (" + str(rangesData[index+2]) + ") must be positive.\n"

            #Append range to identifier
            if i > 0:
                runID += "_"
            runID += str(rangesData[index]) + "to" + str(rangesData[index+1]) + "by" + str(rangesData[index+2])
                
        if errors is True:
            print(errText)
            return "fail"
                
        #Get script
        fileScript = open(filename,"r")
        script = fileScript.read()
        fileScript.close()

        #Replace run ID
        script = script.replace("__RUN_ID__",runID)

        # Add EOF at the beggining to introduce the script in command line
        script = "EOF \n" + script + "\nEOF\n"

        return self.multiparametricRun(execPath, clusterName, "slurm", script, rangesData, nRanges-1)
        
    @line_magic
    def apricot_ls(self, line):

        pipes = subprocess.Popen(["ec3","list"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        std_out, std_err = pipes.communicate()
                    
        std_out = std_out.decode('utf-8')
        std_err = std_err.decode('utf-8')
          
        if pipes.returncode == 0:
            #Send output to notebook
            print(std_out)
            return 
                
        else:
            #Send error to notebook
            ret = "Status: Fail " + str(pipes.returncode) + "\n"
            ret += std_err + "\n"
            ret += std_out
            print(ret)
            return
      
    @line_magic
    def apricottable(self, line):
        # Read the JSON data from the file
        with open('apricot_plugin/clusterList.json') as f:
            data = json.load(f)

        # Initialize clusters list
        clusters = []

        # Iterate through each cluster
        for cluster in data['clusters']:
            cluster_info = {
                'Name': cluster['name'],
                'Cluster ID': cluster['clusterId'],
                'IP': "",
                'State': ""
            }

            # Construct auth-pipe content based on cluster type
            auth_content = f"type = InfrastructureManager; username = user; password = pass;\n"

            # Construct additional credentials based on cluster type
            if cluster['type'] == "OpenStack":
                auth_content += f"id = {cluster['id']}; type = {cluster['type']}; username = {cluster['user']}; password = {cluster['pass']}; host = {cluster['host']}; tenant = {cluster['tenant']}"
            elif cluster['type'] == "OpenNebula":
                auth_content += f"id = {cluster['id']}; type = {cluster['type']}; username = {cluster['user']}; password = {cluster['pass']}; host = {cluster['host']}"
            elif cluster['type'] == "AWS":
                auth_content += f"id = {cluster['id']}; type = {cluster['type']}; username = {cluster['user']}; password = {cluster['pass']}; host = {cluster['host']}"

            # Write auth-pipe content to a file
            with open('auth-pipe', 'w') as auth_file:
                auth_file.write(auth_content)

            # Call im_client.py to get state
            cmdState = [
                'python3',
                '/usr/local/bin/im_client.py',
                'getstate',
                cluster['clusterId'],
                '-r',
                'https://im.egi.eu/im',
                '-a',
                'auth-pipe',
            ]

            # Execute command and capture output
            try:
                state_output = subprocess.check_output(cmdState, universal_newlines=True)
                # Process state output to extract state information
                state_words = state_output.split()
                state_index = state_words.index("state:") if "state:" in state_words else -1
                if state_index != -1 and state_index < len(state_words) - 1:
                    state = state_words[state_index + 1].strip()
                    cluster_info['State'] = state
                else:
                    cluster_info['State'] = "Error: State not found"
            except subprocess.CalledProcessError as e:
                cluster_info['State'] = f"Error: {e.output.strip()}"

            # Call im_client.py to get vm info
            cmdIP = [
                'python3',
                '/usr/local/bin/im_client.py',
                'getvminfo',
                cluster['clusterId'],
                '0',
                'net_interface.1.ip',
                '-r',
                'https://im.egi.eu/im',
                '-a',
                'auth-pipe',
            ]

            # Execute command and capture output
            try:
                ip_output = subprocess.check_output(cmdIP, universal_newlines=True)
                # Process output to extract IP information
                # Check if the output contains an error message
                if "error" in ip_output.lower():
                    ip = "Error: " + ip_output.strip()
                else:
                    # Extract IP address from the output
                    ip = ip_output.split()[-1].strip()
                cluster_info['IP'] = ip
            except subprocess.CalledProcessError as e:
                cluster_info['IP'] = f"Error: {e.output.strip()}"

            clusters.append(cluster_info)

        # Convert clusters to a list of lists for tabulate
        cluster_data = [[cluster['Name'], cluster['Cluster ID'], cluster['IP'], cluster['State']] for cluster in clusters]

        # Print the information as a table using tabulate
        print(tabulate(cluster_data, headers=['Name', 'Cluster ID', 'IP', 'State'], tablefmt='grid'))
        
        # Clean up auth-pipe file after processing
        
        subprocess.run(['rm', 'auth-pipe'])
        return

    @line_magic
    def apricot_nodels(self, line):
        if len(line) == 0:
            print("usage: nodels clustername")
            return "fail"
        #Get cluster name
        clusterName = self.splitClear(line)[0]

        #send instruction
        return self.apricot("exec " + clusterName + " clues status")

    @line_magic
    def apricot_runOn(self, line):
        if len(line) == 0:
            return "fail"
        words = self.splitClear(line)
        if len(words) < 3:
            print("usage: apricot_runOnAll clustername node-list command")
            return "fail"
            
        #Get cluster name
        clusterName = words[0]
        nodeList = words[1]
        command = ' '.join(words[2:])
    
        return self.apricot("exec " + clusterName + " srun -w " + nodeList + " " + command)

    @line_magic
    def apricot_upload(self, line):
        if len(line) == 0:
            print("usage: upload clustername file1 file2 ... fileN destination-path\n")
            return "fail"
        words = self.splitClear(line)
        if len(words) < 3:
            print("usage: upload clustername file1 file2 ... fileN destination-path\n")
            return "fail"

        #Get cluster name
        clusterName = words[0]
        destination = words[len(words)-1]
        #Remove destination from words
        del words[len(words)-1]

        #Add actual directory to destination if required
        if len(destination) == 0:
            if len(self.actualDir) > 0:
                destination = self.actualDir + "/"
        else:
            if len(self.actualDir) > 0 and destination[0] != '/':
                destination = self.actualDir + "/" + destination
        
        nWordsInit = len(words)
        i = 0
        while i < nWordsInit:
            if '*' in words[i]:
                
                fileList = glob.glob(words[i])
                if len(fileList) > 0:
                    words.extend(fileList)
                else:
                    print("No file found with the pattern: '" + words[i] + "'")
                #Remove pattern element
                del words[i]
                i = i-1
                nWordsInit = nWordsInit-1
            i = i+1
            
        #Get ssh instruction
        pipes = subprocess.Popen(["ec3","ssh","--show-only",clusterName], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        
        ssh_instruct, std_err = pipes.communicate()

        ssh_instruct = ssh_instruct.decode('utf-8')
        std_err = std_err.decode('utf-8')
        
        if pipes.returncode == 0:        
            #Replace ssh by scp
            ssh_instruct = self.splitClear(ssh_instruct,'\n')[0]
            ssh_instruct = self.splitClear(ssh_instruct)
            
            #Create empty array for scp instruction
            scp_instruct = []
            #Find user@host field
            skip = False
            host = ""
            for word in ssh_instruct:

                if skip:
                    scp_instruct.append(word)
                    skip = False
                    continue
                
                if word == "sshpass":
                    scp_instruct.append(word)
                    continue
                if word == "ssh":
                    scp_instruct.append("scp")
                    scp_instruct.append("-r")
                    continue

                if word == "-p":
                    scp_instruct.append("-P")
                    skip = True
                    continue
                
                if word[0] == '-':
                    #is an option
                    scp_instruct.append(word)
                    if len(word) == 2:
                        skip = True
                    continue

                #This field contain user@host
                #Store it
                host = word + ":" + destination

            #Append files to upload and host + destination
            scp_instruct.extend(words[1:len(words)])
            scp_instruct.append(host)
            
            #Execute scp
            pipes = subprocess.Popen(scp_instruct, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                    
            std_out, std_err = pipes.communicate()
            std_out = std_out.decode("utf-8")
            std_err = std_err.decode("utf-8")
                    
            if pipes.returncode == 0:
                #Send output to notebook
                print( std_out )
                return "done"
                
            else:
                #Send error to notebook
                print( "Status: Fail " + str(pipes.returncode) + "\n")
                print( std_err )
                return "fail"                
            
    @line_magic
    def apricot_download(self, line):
        if len(line) == 0:
            print("usage: download clustername file1 file2 ... fileN destination-path\n")
            return "fail"
        words = self.splitClear(line)
        if len(words) < 3:
            print("usage: download clustername file1 file2 ... fileN destination-path\n")
            return "fail"

        #Get cluster name
        clusterName = words[0]
        destination = words[len(words)-1]
        #Remove destination from words
        del words[len(words)-1]
        
        #Get ssh instruction
        pipes = subprocess.Popen(["ec3","ssh","--show-only",clusterName], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        
        ssh_instruct, std_err = pipes.communicate()
        ssh_instruct = ssh_instruct.decode("utf-8")
        std_err = std_err.decode("utf-8")
    
        if pipes.returncode == 0:        
            #Replace ssh by scp
            ssh_instruct = self.splitClear(ssh_instruct,'\n')[0]
            ssh_instruct = self.splitClear(ssh_instruct)
            
            #Create empty array for scp instruction
            scp_instruct = []
            #Find user@host field
            skip = False
            host = ""
            for word in ssh_instruct:

                if skip:
                    scp_instruct.append(word)
                    skip = False
                    continue
                
                if word == "sshpass":
                    scp_instruct.append(word)
                    continue
                if word == "ssh":
                    scp_instruct.append("scp")
                    scp_instruct.append("-r")                    
                    continue

                if word == "-p":
                    scp_instruct.append("-P")
                    skip = True
                    continue
                
                if word[0] == '-':
                    #is an option
                    scp_instruct.append(word)
                    if len(word) == 2:
                        skip = True
                    continue

                #This field contain user@host
                #Store it
                host = word
                
            #Append files to download and destination
            for filename in words[1:]:
                
                #Check if actual dir must be added to filename
                if len(self.actualDir) > 0 and filename[0] != '/':
                    filename = self.actualDir + "/" + filename

                scp_instruct.append(host + ":" + filename)

            #Append destination on local machine
            scp_instruct.append(destination)

            #Execute scp
            pipes = subprocess.Popen(scp_instruct, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

            std_out, std_err = pipes.communicate()
            std_out = std_out.decode("utf-8")
            std_err = std_err.decode("utf-8")
                    
            if pipes.returncode == 0:
                #Send output to notebook
                print( std_out )
                return "done"
                
            else:
                #Send error to notebook
                print( "Status: Fail " + str(pipes.returncode) + "\n")
                print( std_err )
                return "fail"                
            
    @line_cell_magic
    def apricot(self, code, cell=None):

        #Check if is a cell call
        if cell != None:
            lines = self.splitClear(cell,'\n')
            for line in lines:
                if len(line) > 0:
                    if self.apricot(line, None) != "done":
                        print("Execution stopped")
                        return ("fail on line: '" + line + "'")
            return "done"

        if len(code) == 0:
            return "fail"
        words = self.splitClear(code)
        #Get first word
        word1 = words[0]
        #Get user command
        userCMD = ""
        if len(words) > 1:
            userCMD = " ".join(words[1:])
        if word1 == "exec" or word1 == "execAsync":
                
            if len(words) < 3:
                print("Incomplete instruction: " + "'" + code + "' \n 'exec' format is: 'exec cluster-name instruction'" )
                return "fail"
            else:
                #Get cluster name
                clusterName = words[1]
                
                #Get command to execute at cluster
                clusterCMD = words[2:]
                
                #Get ssh instruction to execute on cluster
                pipes = subprocess.Popen(["ec3","ssh","--show-only", clusterName], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                        
                ssh_instruct, std_err = pipes.communicate()                
                ssh_instruct = ssh_instruct.decode("utf-8")
                std_err = std_err.decode("utf-8")

                if pipes.returncode == 0:
                        
                    #Send instruction
                    ssh_instruct = self.splitClear(ssh_instruct,"\n")[0]
                    ssh_instruct = self.splitClear(ssh_instruct)
                    ssh_instruct.extend(clusterCMD)
                    pipes = subprocess.Popen(ssh_instruct, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

                    #Check if the call is asyncronous
                    if word1 == "execAsync":
                        return pipes
                    
                    std_out, std_err = pipes.communicate()
                    std_out = std_out.decode("utf-8")
                    std_err = std_err.decode("utf-8")
                
                    if pipes.returncode == 0:
                        #Send output to notebook
                        print( std_out )
                    else:
                        #Send error and output to notebook
                        print( "Status: Fail " + str(pipes.returncode) + "\n")
                        print( std_err + "\n")
                        print( std_out )
                        return "fail"
                else:
                    #Send error to notebook
                    print( "Status: Fail " + str(pipes.returncode) + "\n")
                    print( std_err + "\n" + ssh_instruct)
                    print( "\nCheck if cluster name '" + clusterName + "' exists\n" )
                    return "fail"
                
        elif word1 == "list":
                
            pipes = subprocess.Popen(["im_client.py","list"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                    
            std_out, std_err = pipes.communicate()
            std_out = std_out.decode("utf-8")
            std_err = std_err.decode("utf-8")
                    
            if pipes.returncode == 0:
                #Send output to notebook
                print( std_out )
                
            else:
                #Send error to notebook
                print( "Status: Fail " + str(pipes.returncode) + "\n")
                print( std_err )
                return "fail"                
        elif word1 == "destroy":
                
            if len(userCMD) == 0:
                #Send error to notebook
                print( "cluster name missing\n usage: destroy clustername" )
                return "fail"
            else:
                destroyCMD = ["ec3","destroy","-y"]
                destroyCMD.extend(self.splitClear(userCMD))
                pipes = subprocess.Popen( destroyCMD, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                
                std_out, std_err = pipes.communicate()
                std_out = std_out.decode("utf-8")
                std_err = std_err.decode("utf-8")

                if pipes.returncode == 0:
                    #Send output to notebook
                    print( std_out )
                
                else:
                    #Send error to notebook
                    print( "Status: Fail " + str(pipes.returncode) + "\n")
                    print( std_err )
                    print( std_out )
                    return "fail"                
        else:
            #Unknown command
            print("Unknown command")
            return "fail"
        
        return "done"


def load_ipython_extension(ipython):
    ipython.register_magics(Apricot)