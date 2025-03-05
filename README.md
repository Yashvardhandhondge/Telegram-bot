Example mapping: 
```json
{
   "@user1": {
      "4721232146": ["4624677246", "4655093536"],
      "4667627446": ["4606116331"],
      "2252198484/2": ["2404846297/5", "4655093536"],
      "2252198484/3": ["2404846297/4"],
      "2252198484/4": ["2404846297/3"],
      "4742530327": ["4634087444", "4655093536"]
   }
}
```


Source groups:
```
4721232146 - GroupName: ChainTicker-SRC-VIP-1
4667627446 - GroupName: ChainTicker-SRC-VIP-2
2252198484   - SuperGroupName: ChainTicker-SRC-VIP-3
   2252198484/1 - #General channel
   2252198484/2 - #Signals channel
   2252198484/3 - #Alerts channel
   2252198484/4 - #News channel
4742530327 - GroupName: ChainTicker-SRC-VIP-4
```

Destination groups:
```
4624677246 - GroupName: ChainTicker-DST-VIP-1
4606116331 - GroupName: ChainTicker-DST-VIP-2
2404846297   - SuperGroupName: ChainTicker-DST-VIP-3
   2404846297/1 - #General channel
   2404846297/5 - #Signals channel
   2404846297/4 - #Alerts channel
   2404846297/3 - #News channel
4634087444 - GroupName: ChainTicker-DST-VIP-4
4655093536 - GroupName: ChainTicker-DST-VIP-5
```